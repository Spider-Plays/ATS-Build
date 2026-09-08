import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { mapActivityLog, mapCandidate, mapRequirement } from '../utils/mappers.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { INTERVIEW_PLAN_EDITORS, REQ_APPROVERS, REQUIREMENT_API_ROLES, STAFF_MUTATE } from '../lib/roles.js';
import { ensureInterviewPlan, getCandidateStageProgress, mapPlanResponse, resolveCreateInterviewPanels, } from '../lib/interviewPlan.js';
import { logActivity } from '../services/activityLog.js';
import { generateJobCode } from '../lib/jobCode.js';
import { parseSkillList, serializeSkills } from '../lib/skills.js';
import { computeMatchScore, loadCandidateResumeText, rankCandidatesForRequirement, } from '../lib/profileMatching.js';
import { appendRequirementVersion, parseRequirementVersions, snapshotLinkedCandidates, snapshotMatchingProfiles, } from '../lib/requirementVersions.js';
import { pickRequirementExtrasForCreate, pickRequirementExtrasPatch, parseOptionalDate, RequirementFieldError, } from '../lib/requirementFields.js';
import { buildApprovalRecord, parseRequirementApprovalBody, requireApprovalComments, } from '../lib/requirementApproval.js';
import { assertCanApproveRequirement, assertCanManageRequirementPosting, assertCanUpdateHiringStage, HIRING_STAGE_EDIT_ROLES, PORTAL_VISIBILITY_ROLES, POSTING_CONTROL_ROLES, REQUIREMENT_ASSIGNMENT_ROLES, } from '../lib/requirementPermissions.js';
import { parseRequirementClientInput, resolveClientFromCatalog, } from '../lib/clientCatalog.js';
import { isRequirementAcceptingCandidates, requirementApplicationsClosedMessage } from '../lib/requirementHiring.js';
import { refreshRequirementHiringState, syncRequirementHiringState } from '../lib/hiring.js';
import { assertCanAddCandidatesToRequirement, assertCanViewRequirement, buildRequirementListWhere, RequirementAccessError, } from '../lib/requirementAccess.js';
import { assertCanViewCandidate, buildCandidateListWhere, buildCandidateMatchPoolWhere, CandidateAccessError, } from '../lib/candidateAccess.js';
import { buildRequirementTagUpdate } from '../lib/candidateStatuses.js';
import { notifyCandidateStatusChange, notifyVendorAssignment } from '../lib/emailDispatch.js';
import { hasOrgWideAccess } from '../lib/orgAccess.js';
import { getCatalogSkillNames } from '../lib/skillCatalog.js';
import { extractResumeText } from '../lib/resumeParse.js';
import { parseJobDescriptionSkills } from '../lib/jdParse.js';
import { handleUploadResume } from '../middleware/uploadResume.js';
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles(...REQUIREMENT_API_ROLES));
router.get('/', async (req, res) => {
    const listWhere = await buildRequirementListWhere(req.auth);
    const rows = await prisma.requirement.findMany({
        where: listWhere,
        orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(mapRequirement));
});
router.get('/pending', async (req, res) => {
    const listWhere = await buildRequirementListWhere(req.auth);
    const rows = await prisma.requirement.findMany({
        where: { ...listWhere, status: 'PENDING_APPROVAL' },
        orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(mapRequirement));
});
router.post('/parse-job-description', requireRoles(...STAFF_MUTATE, 'HIRING_MANAGER'), handleUploadResume, async (req, res) => {
    try {
        let text = typeof req.body?.jobDescription === 'string' ? req.body.jobDescription.trim() : '';
        if (req.file) {
            const fileText = await extractResumeText(req.file.buffer, req.file.mimetype, req.file.originalname);
            text = fileText || text;
        }
        if (!text || text.length < 20) {
            return res.status(422).json({
                error: 'Job description must be at least 20 characters. Paste text or upload a PDF/DOCX.',
            });
        }
        const catalog = await getCatalogSkillNames();
        const { primarySkills, secondarySkills } = parseJobDescriptionSkills(text, catalog);
        res.json({
            jobDescription: text.slice(0, 50_000),
            primarySkills,
            secondarySkills,
        });
    }
    catch (err) {
        console.error('Job description parse failed:', err);
        const message = err instanceof Error ? err.message : 'Could not parse job description';
        res.status(422).json({ error: message });
    }
});
router.get('/:id/matching-profiles', async (req, res) => {
    try {
        await assertCanViewRequirement(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof RequirementAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const requirement = await prisma.requirement.findUnique({
        where: { id: req.params.id },
    });
    if (!requirement)
        return res.status(404).json({ error: 'Not found' });
    const refreshed = await refreshRequirementHiringState(req.params.id);
    if (!refreshed || !isRequirementAcceptingCandidates(refreshed)) {
        return res.json({ matches: [], totalCandidates: 0, acceptingApplications: false });
    }
    const candidateScope = await buildCandidateMatchPoolWhere(req.auth, req.params.id);
    const candidates = await prisma.candidate.findMany({
        where: candidateScope,
        orderBy: { updatedAt: 'desc' },
    });
    const catalog = await getCatalogSkillNames();
    const ranked = await rankCandidatesForRequirement(candidates, requirement, req.params.id, catalog);
    const candidateById = new Map(candidates.map((c) => [c.id, c]));
    const minScore = Number(req.query.minScore) || 15;
    const matches = ranked
        .filter((m) => {
        if (m.alreadyLinked)
            return true;
        if (m.linkedToOther)
            return false;
        const c = candidateById.get(m.candidateId);
        // Always surface unlinked candidates; apply min score only as a fallback guard.
        if (!c?.requirementId)
            return true;
        return m.matchScore >= minScore;
    })
        .slice(0, 40)
        .map((m) => {
        const c = candidateById.get(m.candidateId);
        return {
            candidateId: m.candidateId,
            matchScore: m.matchScore,
            breakdown: m.breakdown,
            alreadyLinked: m.alreadyLinked,
            linkedToOther: m.linkedToOther,
            candidate: mapCandidate(c, { requirement }),
        };
    });
    res.json({ matches, totalCandidates: candidates.length });
});
router.post('/:id/link-candidate', requireRoles(...STAFF_MUTATE), async (req, res) => {
    const candidateId = typeof req.body.candidateId === 'string' ? req.body.candidateId : '';
    if (!candidateId) {
        return res.status(400).json({ error: 'candidateId is required' });
    }
    try {
        await assertCanAddCandidatesToRequirement(req.auth, req.params.id);
        await assertCanViewCandidate(req.auth, candidateId);
    }
    catch (err) {
        if (err instanceof RequirementAccessError || err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const [requirement, candidate] = await Promise.all([
        prisma.requirement.findUnique({ where: { id: req.params.id } }),
        prisma.candidate.findUnique({ where: { id: candidateId } }),
    ]);
    if (!requirement)
        return res.status(404).json({ error: 'Requirement not found' });
    if (!candidate)
        return res.status(404).json({ error: 'Candidate not found' });
    const refreshedRequirement = await refreshRequirementHiringState(requirement.id);
    if (!refreshedRequirement || !isRequirementAcceptingCandidates(refreshedRequirement)) {
        return res.status(400).json({
            error: requirementApplicationsClosedMessage(refreshedRequirement ?? requirement),
        });
    }
    if (candidate.requirementId === requirement.id) {
        return res.status(409).json({ error: 'Candidate is already linked to this requirement.' });
    }
    if (candidate.requirementId && candidate.requirementId !== requirement.id) {
        return res.status(409).json({
            error: 'This candidate is assigned to another requirement. Change their job assignment on the candidate profile to move them.',
        });
    }
    const resumeText = await loadCandidateResumeText(candidate);
    const catalog = await getCatalogSkillNames();
    const { score } = computeMatchScore(candidate, requirement, resumeText, catalog);
    const requirementTagUpdate = buildRequirementTagUpdate(candidate.status, candidate.requirementId, requirement.id);
    const updated = await prisma.candidate.update({
        where: { id: candidateId },
        data: {
            requirementId: requirement.id,
            matchScore: score,
            jobTitle: requirement.title,
            ...(requirementTagUpdate.status && { status: requirementTagUpdate.status }),
            ...(requirementTagUpdate.submittedAt !== undefined && {
                submittedAt: requirementTagUpdate.submittedAt,
            }),
            updatedAt: new Date(),
        },
    });
    if (requirementTagUpdate.status && requirementTagUpdate.status !== candidate.status) {
        await logActivity({
            entityType: 'CANDIDATE',
            entityId: candidate.id,
            action: 'STATUS_CHANGED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: {
                previousStatus: candidate.status,
                newStatus: requirementTagUpdate.status,
                via: 'requirement_link',
            },
        });
        notifyCandidateStatusChange({
            id: updated.id,
            email: updated.email,
            name: updated.name,
            status: updated.status,
            jobTitle: updated.jobTitle,
            requirementId: updated.requirementId,
            referredByUserId: updated.referredByUserId,
        }, candidate.status);
    }
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: candidate.id,
        action: 'LINKED_TO_REQUIREMENT',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {
            requirementId: requirement.id,
            jobCode: requirement.jobCode,
            matchScore: score,
        },
    });
    const candidateScope = await buildCandidateListWhere(req.auth);
    await appendRequirementVersion(requirement.id, {
        changedBy: req.auth.userId,
        kind: 'CANDIDATE_LINKED',
        changes: {
            candidateId: candidate.id,
            candidateName: candidate.name,
            candidateEmail: candidate.email,
            matchScore: score,
        },
        incrementVersion: false,
        candidateWhere: candidateScope,
    });
    await syncRequirementHiringState(requirement.id);
    res.json(mapCandidate(updated, { requirement }));
});
router.get('/:id/interview-plan', async (req, res) => {
    try {
        await assertCanViewRequirement(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof RequirementAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const requirement = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!requirement)
        return res.status(404).json({ error: 'Not found' });
    const plan = await ensureInterviewPlan(req.params.id);
    res.json(mapPlanResponse(plan));
});
router.put('/:id/interview-plan', requireRoles(...INTERVIEW_PLAN_EDITORS), async (req, res) => {
    const requirement = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!requirement)
        return res.status(404).json({ error: 'Not found' });
    const incoming = req.body?.stages;
    if (!Array.isArray(incoming) || incoming.length < 1) {
        return res.status(400).json({ error: 'At least one interview stage is required' });
    }
    for (let i = 0; i < incoming.length; i++) {
        const name = typeof incoming[i]?.name === 'string' ? incoming[i].name.trim() : '';
        if (!name) {
            return res.status(400).json({ error: `Stage ${i + 1} must have a name` });
        }
    }
    const plan = await ensureInterviewPlan(req.params.id);
    const existing = [...plan.stages].sort((a, b) => a.order - b.order);
    const existingById = new Map(existing.map((s) => [s.id, s]));
    const parseStagePayload = (item) => ({
        name: String(item.name).trim(),
        interviewType: typeof item.interviewType === 'string' && item.interviewType.trim()
            ? item.interviewType.trim()
            : 'TECHNICAL',
        defaultDuration: typeof item.defaultDuration === 'number' && item.defaultDuration >= 15
            ? item.defaultDuration
            : 60,
        defaultInterviewerIds: JSON.stringify(Array.isArray(item.defaultInterviewerIds) ? item.defaultInterviewerIds : []),
    });
    const deleteStagesIfAllowed = async (removedIds) => {
        if (removedIds.length === 0)
            return;
        const interviewCount = await prisma.interview.count({
            where: { planStageId: { in: removedIds } },
        });
        if (interviewCount > 0) {
            throw new Error('Cannot remove stages that already have scheduled or completed interviews');
        }
        await prisma.interviewPlanStage.deleteMany({
            where: { id: { in: removedIds } },
        });
    };
    const hasStageIds = incoming.some((item) => typeof item?.id === 'string' && String(item.id).trim().length > 0);
    const updatedStages = [];
    if (hasStageIds) {
        const incomingStages = incoming.map((item) => {
            const stageId = typeof item?.id === 'string' ? item.id.trim() : '';
            return { stageId, fields: parseStagePayload(item) };
        });
        const removedIds = existing
            .filter((s) => !incomingStages.some((inc) => inc.stageId === s.id))
            .map((s) => s.id);
        try {
            await deleteStagesIfAllowed(removedIds);
        }
        catch (e) {
            return res.status(400).json({
                error: e instanceof Error ? e.message : 'Cannot remove stages',
            });
        }
        const removedIdSet = new Set(removedIds);
        const survivingExisting = existing.filter((s) => !removedIdSet.has(s.id));
        let saved;
        try {
            saved = await prisma.$transaction(async (tx) => {
                const tempOffset = 10_000;
                for (let i = 0; i < survivingExisting.length; i++) {
                    await tx.interviewPlanStage.update({
                        where: { id: survivingExisting[i].id },
                        data: { order: tempOffset + i },
                    });
                }
                const rows = [];
                for (let i = 0; i < incomingStages.length; i++) {
                    const { stageId, fields } = incomingStages[i];
                    if (stageId && existingById.has(stageId) && !removedIdSet.has(stageId)) {
                        rows.push(await tx.interviewPlanStage.update({
                            where: { id: stageId },
                            data: { order: i, ...fields },
                        }));
                    }
                    else {
                        rows.push(await tx.interviewPlanStage.create({
                            data: { planId: plan.id, order: i, ...fields },
                        }));
                    }
                }
                return rows;
            });
        }
        catch (e) {
            console.error('Interview plan update failed:', e);
            return res.status(500).json({
                error: 'Failed to update interview stages. Please try again.',
            });
        }
        updatedStages.push(...saved);
    }
    else {
        if (incoming.length < existing.length) {
            const removedIds = existing.slice(incoming.length).map((s) => s.id);
            try {
                await deleteStagesIfAllowed(removedIds);
            }
            catch (e) {
                return res.status(400).json({
                    error: e instanceof Error ? e.message : 'Cannot remove stages',
                });
            }
        }
        for (let i = 0; i < incoming.length; i++) {
            const item = incoming[i];
            const fields = parseStagePayload(item);
            if (i < existing.length) {
                const row = await prisma.interviewPlanStage.update({
                    where: { id: existing[i].id },
                    data: { order: i, ...fields },
                });
                updatedStages.push(row);
            }
            else {
                const row = await prisma.interviewPlanStage.create({
                    data: { planId: plan.id, order: i, ...fields },
                });
                updatedStages.push(row);
            }
        }
    }
    await prisma.interviewPlan.update({
        where: { id: plan.id },
        data: { updatedAt: new Date() },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: requirement.id,
        action: 'INTERVIEW_PLAN_UPDATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { stageCount: incoming.length },
    });
    res.json(mapPlanResponse({
        ...plan,
        stages: updatedStages.sort((a, b) => a.order - b.order),
    }));
});
router.get('/:id/interview-plan/candidate/:candidateId/progress', async (req, res) => {
    try {
        await assertCanViewRequirement(req.auth, req.params.id);
        await assertCanViewCandidate(req.auth, req.params.candidateId);
    }
    catch (err) {
        if (err instanceof RequirementAccessError || err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const requirement = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!requirement)
        return res.status(404).json({ error: 'Not found' });
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.candidateId } });
    if (!candidate)
        return res.status(404).json({ error: 'Candidate not found' });
    const progress = await getCandidateStageProgress(req.params.id, req.params.candidateId);
    res.json(progress);
});
/** Full activity history for anyone who can open this requirement detail (same access as GET /:id). */
router.get('/:id/activity-logs', async (req, res) => {
    try {
        await assertCanViewRequirement(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof RequirementAccessError) {
            const status = err.message === 'Requirement not found' ? 404 : 403;
            return res.status(status).json({ error: err.message });
        }
        throw err;
    }
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const rows = await prisma.activityLog.findMany({
        where: { entityId: req.params.id, entityType: 'REQUIREMENT' },
        orderBy: { timestamp: 'desc' },
        take: limit,
    });
    res.json(rows.map(mapActivityLog));
});
router.get('/:id', async (req, res) => {
    try {
        await assertCanViewRequirement(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof RequirementAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const row = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Not found' });
    if (['LIVE', 'ON_HOLD', 'CLOSED'].includes(row.status)) {
        await syncRequirementHiringState(row.id);
    }
    const refreshed = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!refreshed)
        return res.status(404).json({ error: 'Not found' });
    res.json(mapRequirement(refreshed));
});
router.post('/', requireRoles(...STAFF_MUTATE, 'HIRING_MANAGER'), async (req, res) => {
    const body = req.body;
    let extras;
    try {
        extras = pickRequirementExtrasForCreate(body);
    }
    catch (e) {
        if (e instanceof RequirementFieldError) {
            return res.status(400).json({ error: e.message });
        }
        throw e;
    }
    const timestamp = new Date();
    let clientName;
    try {
        clientName = await resolveClientFromCatalog(parseRequirementClientInput(body.client));
    }
    catch (e) {
        return res.status(400).json({
            error: e instanceof Error ? e.message : 'Invalid client',
        });
    }
    let stageInterviewerIdsByOrder;
    try {
        stageInterviewerIdsByOrder = await resolveCreateInterviewPanels(body);
    }
    catch (e) {
        return res.status(400).json({
            error: e instanceof Error ? e.message : 'Invalid interview panels',
        });
    }
    const row = await prisma.requirement.create({
        data: {
            jobCode: await generateJobCode(),
            client: clientName,
            title: body.title,
            department: body.department,
            hiringManager: body.hiringManager,
            status: 'PENDING_APPROVAL',
            openings: body.openings,
            filled: 0,
            priority: body.priority,
            ...extras,
            description: body.description ??
                (typeof body.jobDescription === 'string'
                    ? body.jobDescription.slice(0, 2000)
                    : null),
            jobDescription: typeof body.jobDescription === 'string'
                ? body.jobDescription
                : body.description ?? null,
            primarySkills: serializeSkills(parseSkillList(body.primarySkills)),
            secondarySkills: serializeSkills(parseSkillList(body.secondarySkills)),
            createdBy: body.createdBy ?? req.auth.userId,
            createdByRole: body.createdByRole ?? req.auth.role,
            recruiters: '[]',
            approval: JSON.stringify({ decision: 'PENDING' }),
            approvalHistory: JSON.stringify([
                {
                    action: 'REQUESTED',
                    by: body.createdBy ?? req.auth.userId,
                    at: timestamp.toISOString(),
                    role: body.createdByRole ?? req.auth.role,
                },
            ]),
            versions: '[]',
            currentVersion: 1,
            visibleToCandidates: body.visibleToCandidates ?? false,
        },
    });
    await ensureInterviewPlan(row.id, { stageInterviewerIdsByOrder });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'CREATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { title: body.title },
    });
    res.status(201).json(mapRequirement(row));
});
router.patch('/:id', requireRoles(...STAFF_MUTATE, 'HIRING_MANAGER'), async (req, res) => {
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const data = { ...req.body };
    delete data._user;
    let extras = {};
    try {
        extras = pickRequirementExtrasPatch(data);
        Object.assign(data, extras);
    }
    catch (e) {
        if (e instanceof RequirementFieldError) {
            return res.status(400).json({ error: e.message });
        }
        throw e;
    }
    if (data.department !== undefined && !hasOrgWideAccess(req.auth.role)) {
        return res.status(403).json({ error: 'Only HR leadership roles can change department' });
    }
    if (data.client !== undefined) {
        try {
            data.client = await resolveClientFromCatalog(parseRequirementClientInput(data.client));
        }
        catch (e) {
            return res.status(400).json({
                error: e instanceof Error ? e.message : 'Invalid client',
            });
        }
    }
    const versions = parseRequirementVersions(existing.versions);
    const timestamp = new Date().toISOString();
    const candidateScope = await buildCandidateListWhere(req.auth);
    const [linkedCandidates, matchingProfiles] = await Promise.all([
        snapshotLinkedCandidates(req.params.id),
        snapshotMatchingProfiles(existing, req.params.id, candidateScope),
    ]);
    versions.push({
        version: existing.currentVersion,
        changedBy: req.auth.userId,
        changedAt: timestamp,
        kind: 'UPDATE',
        changes: data,
        linkedCandidates,
        matchingProfiles,
    });
    /** Saving a hold start date on a live role also places it on hold. */
    const placingOnHold = existing.status === 'LIVE' &&
        Object.prototype.hasOwnProperty.call(extras, 'holdStartDate') &&
        extras.holdStartDate instanceof Date;
    /** Clearing hold start while on hold resumes the role. */
    const resumingFromHold = existing.status === 'ON_HOLD' &&
        Object.prototype.hasOwnProperty.call(extras, 'holdStartDate') &&
        extras.holdStartDate === null;
    const history = JSON.parse(existing.approvalHistory || '[]');
    if (placingOnHold) {
        history.push({
            action: 'ON_HOLD',
            by: req.auth.userId,
            at: timestamp,
            role: req.auth.role,
        });
    }
    else if (resumingFromHold) {
        history.push({
            action: 'RESUMED',
            by: req.auth.userId,
            at: timestamp,
            role: req.auth.role,
        });
    }
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            ...pickRequirementFields(data),
            ...extras,
            ...(placingOnHold && {
                status: 'ON_HOLD',
                onHoldAt: new Date(),
                visibleToCandidates: false,
                approvalHistory: JSON.stringify(history),
            }),
            ...(resumingFromHold && {
                status: 'LIVE',
                onHoldAt: null,
                visibleToCandidates: true,
                holdEndDate: extras.holdEndDate instanceof Date ? extras.holdEndDate : new Date(),
                approvalHistory: JSON.stringify(history),
            }),
            updatedAt: new Date(),
            currentVersion: existing.currentVersion + 1,
            versions: JSON.stringify(versions),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'UPDATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: Object.keys(data),
    });
    if (placingOnHold || resumingFromHold) {
        await logActivity({
            entityType: 'REQUIREMENT',
            entityId: row.id,
            action: placingOnHold ? 'ON_HOLD' : 'RESUMED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: { status: placingOnHold ? 'ON_HOLD' : 'LIVE' },
        });
    }
    if (['LIVE', 'ON_HOLD', 'CLOSED'].includes(row.status)) {
        await syncRequirementHiringState(row.id);
    }
    const refreshed = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    res.json(mapRequirement(refreshed ?? row));
});
const REQUIREMENT_STATUSES = [
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'LIVE',
    'ON_HOLD',
    'CLOSED',
    'CANCELLED',
    'REJECTED',
];
router.patch('/:id/status', requireRoles(...POSTING_CONTROL_ROLES), async (req, res) => {
    const status = req.body.status;
    if (!REQUIREMENT_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const actor = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { name: true },
    });
    try {
        assertCanManageRequirementPosting({ userId: req.auth.userId, role: req.auth.role, name: actor?.name }, { createdBy: existing.createdBy, hiringManager: existing.hiringManager });
    }
    catch (e) {
        return res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
    }
    if (status === 'ON_HOLD' && !['LIVE'].includes(existing.status)) {
        return res.status(400).json({ error: 'Only live requirements can be placed on hold' });
    }
    if (status === 'LIVE' && existing.status !== 'ON_HOLD') {
        return res.status(400).json({ error: 'Only on-hold requirements can be resumed' });
    }
    const timestamp = new Date().toISOString();
    const history = JSON.parse(existing.approvalHistory || '[]');
    if (status === 'ON_HOLD') {
        history.push({
            action: 'ON_HOLD',
            by: req.auth.userId,
            at: timestamp,
            role: req.auth.role,
        });
    }
    else if (status === 'LIVE' && existing.status === 'ON_HOLD') {
        history.push({
            action: 'RESUMED',
            by: req.auth.userId,
            at: timestamp,
            role: req.auth.role,
        });
    }
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            status,
            updatedAt: new Date(),
            approvalHistory: JSON.stringify(history),
            ...(status === 'ON_HOLD' && {
                visibleToCandidates: false,
                onHoldAt: new Date(),
                ...(!existing.holdStartDate ? { holdStartDate: new Date() } : {}),
            }),
            ...(status === 'LIVE' &&
                existing.status === 'ON_HOLD' && {
                visibleToCandidates: true,
                onHoldAt: null,
                ...(!existing.holdEndDate ? { holdEndDate: new Date() } : {}),
            }),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: status === 'ON_HOLD' ? 'ON_HOLD' : status === 'LIVE' ? 'RESUMED' : 'STATUS_CHANGED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { status },
    });
    res.json(mapRequirement(row));
});
router.patch('/:id/hiring-stage', requireRoles(...HIRING_STAGE_EDIT_ROLES), async (req, res) => {
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        assertCanUpdateHiringStage({ userId: req.auth.userId, role: req.auth.role }, { status: existing.status });
    }
    catch (e) {
        return res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
    }
    await syncRequirementHiringState(req.params.id);
    const row = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Not found' });
    res.json(mapRequirement(row));
});
router.post('/:id/cancel', requireRoles(...POSTING_CONTROL_ROLES), async (req, res) => {
    const reason = typeof req.body.closureReason === 'string' ? req.body.closureReason.trim() : '';
    const closedAt = parseOptionalDate(req.body.closedAt ?? req.body.closureDate);
    if (reason.length < 3) {
        return res.status(400).json({ error: 'Closure reason is required (at least 3 characters)' });
    }
    if (!closedAt) {
        return res.status(400).json({ error: 'Closure date is required' });
    }
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const actor = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { name: true },
    });
    try {
        assertCanManageRequirementPosting({ userId: req.auth.userId, role: req.auth.role, name: actor?.name }, { createdBy: existing.createdBy, hiringManager: existing.hiringManager });
    }
    catch (e) {
        return res.status(403).json({ error: e instanceof Error ? e.message : 'Forbidden' });
    }
    if (!['LIVE', 'ON_HOLD'].includes(existing.status)) {
        return res.status(400).json({
            error: 'Only live or on-hold requirements can be cancelled',
        });
    }
    const timestamp = new Date().toISOString();
    const history = JSON.parse(existing.approvalHistory || '[]');
    history.push({
        action: 'CANCELLED',
        by: req.auth.userId,
        at: timestamp,
        role: req.auth.role,
        comments: reason,
    });
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            status: 'CANCELLED',
            closureReason: reason.slice(0, 2000),
            closedAt,
            onHoldAt: null,
            visibleToCandidates: false,
            updatedAt: new Date(),
            approvalHistory: JSON.stringify(history),
            approval: JSON.stringify({
                decision: 'CANCELLED',
                decidedBy: req.auth.userId,
                decidedAt: timestamp,
            }),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'CANCELLED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { closureReason: reason, closedAt: closedAt.toISOString() },
    });
    res.json(mapRequirement(row));
});
router.patch('/:id/visibility', requireRoles(...PORTAL_VISIBILITY_ROLES), async (req, res) => {
    const visibleToCandidates = Boolean(req.body.visibleToCandidates);
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    if (existing.status === 'ON_HOLD') {
        return res.status(400).json({
            error: 'Resume the requirement before changing portal visibility',
        });
    }
    if (existing.status === 'CLOSED' || existing.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Closed or cancelled requirements cannot be shown on the portal' });
    }
    const timestamp = new Date().toISOString();
    const approvalHistory = JSON.parse(existing.approvalHistory || '[]');
    approvalHistory.push({
        action: visibleToCandidates ? 'PORTAL_SHOWN' : 'PORTAL_HIDDEN',
        by: req.auth.userId,
        at: timestamp,
        role: req.auth.role,
    });
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            visibleToCandidates,
            approvalHistory: JSON.stringify(approvalHistory),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: visibleToCandidates ? 'VISIBLE_ON_PORTAL' : 'HIDDEN_FROM_PORTAL',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
    });
    res.json(mapRequirement(row));
});
router.patch('/:id/referral-visibility', requireRoles(...PORTAL_VISIBILITY_ROLES), async (req, res) => {
    const visibleToReferrals = Boolean(req.body.visibleToReferrals);
    const referralBonusAmount = req.body.referralBonusAmount === null || req.body.referralBonusAmount === undefined
        ? undefined
        : Number(req.body.referralBonusAmount);
    if (referralBonusAmount !== undefined &&
        (Number.isNaN(referralBonusAmount) || referralBonusAmount < 0)) {
        return res.status(400).json({ error: 'Referral bonus must be a non-negative number' });
    }
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    if (existing.status === 'ON_HOLD') {
        return res.status(400).json({
            error: 'Resume the requirement before changing referral visibility',
        });
    }
    if (existing.status === 'CLOSED' || existing.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Closed or cancelled requirements cannot accept referrals' });
    }
    const timestamp = new Date().toISOString();
    const approvalHistory = JSON.parse(existing.approvalHistory || '[]');
    approvalHistory.push({
        action: visibleToReferrals ? 'REFERRAL_PORTAL_SHOWN' : 'REFERRAL_PORTAL_HIDDEN',
        by: req.auth.userId,
        at: timestamp,
        role: req.auth.role,
    });
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            visibleToReferrals,
            ...(referralBonusAmount !== undefined ? { referralBonusAmount } : {}),
            approvalHistory: JSON.stringify(approvalHistory),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: visibleToReferrals ? 'REFERRAL_PORTAL_SHOWN' : 'REFERRAL_PORTAL_HIDDEN',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: referralBonusAmount !== undefined ? { referralBonusAmount } : undefined,
    });
    res.json(mapRequirement(row));
});
router.get('/:id/vendors', requireRoles(...PORTAL_VISIBILITY_ROLES, 'RECRUITER'), async (req, res) => {
    const existing = await prisma.requirement.findUnique({
        where: { id: req.params.id },
        select: { id: true },
    });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const rows = await prisma.vendorRequirement.findMany({
        where: { requirementId: req.params.id },
        select: { vendorId: true },
    });
    res.json({ vendorIds: rows.map((r) => r.vendorId) });
});
router.put('/:id/vendors', requireRoles(...REQUIREMENT_ASSIGNMENT_ROLES), async (req, res) => {
    const vendorIds = z
        .object({ vendorIds: z.array(z.string().min(1)) })
        .parse(req.body).vendorIds;
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    if (existing.status === 'ON_HOLD') {
        return res.status(400).json({
            error: 'Resume the requirement before assigning vendors',
        });
    }
    if (existing.status === 'CLOSED' || existing.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Closed or cancelled requirements cannot be opened to vendors' });
    }
    if (existing.status !== 'LIVE') {
        return res.status(400).json({ error: 'Only live requirements can be assigned to vendors' });
    }
    const uniqueVendorIds = [...new Set(vendorIds)];
    if (uniqueVendorIds.length > 0) {
        const vendors = await prisma.vendor.findMany({
            where: { id: { in: uniqueVendorIds }, status: 'ACTIVE' },
            include: { onboarding: { select: { status: true } } },
        });
        if (vendors.length !== uniqueVendorIds.length) {
            return res.status(400).json({ error: 'One or more vendors were not found or are inactive' });
        }
        const notApproved = vendors.filter((v) => {
            const status = v.onboarding?.status ?? null;
            return status != null && status !== 'APPROVED';
        });
        if (notApproved.length > 0) {
            return res.status(400).json({
                error: `Only approved vendors can be assigned: ${notApproved.map((v) => v.name).join(', ')}`,
            });
        }
    }
    const current = await prisma.vendorRequirement.findMany({
        where: { requirementId: existing.id },
        select: { vendorId: true },
    });
    const currentIds = new Set(current.map((r) => r.vendorId));
    const nextIds = new Set(uniqueVendorIds);
    const toAdd = uniqueVendorIds.filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
    if (toAdd.length > 0) {
        await prisma.vendorRequirement.createMany({
            data: toAdd.map((vendorId) => ({
                vendorId,
                requirementId: existing.id,
                assignedBy: req.auth.userId,
            })),
            skipDuplicates: true,
        });
    }
    if (toRemove.length > 0) {
        await prisma.vendorRequirement.deleteMany({
            where: {
                requirementId: existing.id,
                vendorId: { in: toRemove },
            },
        });
    }
    const row = await prisma.requirement.update({
        where: { id: existing.id },
        data: {
            visibleToVendors: uniqueVendorIds.length > 0,
            updatedAt: new Date(),
        },
    });
    if (toAdd.length > 0) {
        const addedVendors = await prisma.vendor.findMany({
            where: { id: { in: toAdd } },
            select: { id: true, name: true },
        });
        for (const vendor of addedVendors) {
            notifyVendorAssignment(vendor, [{ title: existing.title, jobCode: existing.jobCode }]);
        }
    }
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'VENDORS_ASSIGNED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {
            vendorIds: uniqueVendorIds,
            added: toAdd,
            removed: toRemove,
        },
    });
    res.json({ vendorIds: uniqueVendorIds, requirement: mapRequirement(row) });
});
router.post('/:id/approve', requireRoles(...REQ_APPROVERS), async (req, res) => {
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const approvalBody = parseRequirementApprovalBody(req.body);
    let comments;
    try {
        comments = requireApprovalComments(approvalBody.comments);
    }
    catch (e) {
        return res.status(400).json({
            error: e instanceof Error ? e.message : 'A comment is required',
        });
    }
    try {
        assertCanApproveRequirement(req.auth, {
            createdBy: existing.createdBy,
            createdByRole: existing.createdByRole,
        }, approvalBody);
    }
    catch (e) {
        return res.status(403).json({
            error: e instanceof Error ? e.message : 'Not allowed to approve this requirement',
        });
    }
    if (existing.status !== 'PENDING_APPROVAL') {
        return res.status(400).json({ error: 'Only pending requirements can be approved' });
    }
    const { timestamp, historyEntry, approval } = buildApprovalRecord('APPROVED', req.auth, approvalBody.onBehalfOfHrHead === true, comments);
    const history = JSON.parse(existing.approvalHistory || '[]');
    history.push(historyEntry);
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            status: 'LIVE',
            visibleToCandidates: true,
            liveAt: existing.liveAt ?? new Date(),
            hiringStage: existing.hiringStage || 'SOURCING',
            approval: JSON.stringify(approval),
            approvalHistory: JSON.stringify(history),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'APPROVED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: approval.onBehalfOf ? { onBehalfOf: approval.onBehalfOf } : undefined,
    });
    res.json(mapRequirement(row));
});
router.post('/:id/reject', requireRoles(...REQ_APPROVERS), async (req, res) => {
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const approvalBody = parseRequirementApprovalBody(req.body);
    let comments;
    try {
        comments = requireApprovalComments(approvalBody.comments);
    }
    catch (e) {
        return res.status(400).json({
            error: e instanceof Error ? e.message : 'A comment is required',
        });
    }
    try {
        assertCanApproveRequirement(req.auth, {
            createdBy: existing.createdBy,
            createdByRole: existing.createdByRole,
        }, approvalBody);
    }
    catch (e) {
        return res.status(403).json({
            error: e instanceof Error ? e.message : 'Not allowed to reject this requirement',
        });
    }
    if (existing.status !== 'PENDING_APPROVAL') {
        return res.status(400).json({ error: 'Only pending requirements can be rejected' });
    }
    const { historyEntry, approval } = buildApprovalRecord('REJECTED', req.auth, approvalBody.onBehalfOfHrHead === true, comments);
    const history = JSON.parse(existing.approvalHistory || '[]');
    history.push(historyEntry);
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            status: 'REJECTED',
            approval: JSON.stringify(approval),
            approvalHistory: JSON.stringify(history),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'REJECTED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: approval.onBehalfOf ? { onBehalfOf: approval.onBehalfOf } : undefined,
    });
    res.json(mapRequirement(row));
});
router.post('/:id/assign-recruiter', requireRoles(...REQUIREMENT_ASSIGNMENT_ROLES), async (req, res) => {
    const recruiterId = typeof req.body.recruiterId === 'string' ? req.body.recruiterId.trim() : '';
    if (!recruiterId)
        return res.status(400).json({ error: 'Recruiter is required' });
    const recruiterUser = await prisma.user.findUnique({ where: { id: recruiterId } });
    if (!recruiterUser || recruiterUser.role !== 'RECRUITER') {
        return res.status(400).json({ error: 'Only users with the Recruiter role can be assigned' });
    }
    if (recruiterUser.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'Recruiter account must be active' });
    }
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const recruiters = JSON.parse(existing.recruiters || '[]');
    const pending = JSON.parse(existing.pendingRecruiters || '[]');
    if (recruiters.includes(recruiterId) || pending.includes(recruiterId)) {
        return res.json(mapRequirement(existing));
    }
    pending.push(recruiterId);
    const timestamp = new Date().toISOString();
    const approvalHistory = JSON.parse(existing.approvalHistory || '[]');
    approvalHistory.push({
        action: 'RECRUITER_INVITED',
        by: req.auth.userId,
        at: timestamp,
        role: req.auth.role,
        recruiterId,
    });
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            pendingRecruiters: JSON.stringify(pending),
            approvalHistory: JSON.stringify(approvalHistory),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'RECRUITER_INVITED',
        performedBy: req.auth.userId,
        details: { recruiterId },
    });
    res.json(mapRequirement(row));
});
router.post('/:id/assign-recruiter/:recruiterId/accept', requireRoles('RECRUITER'), async (req, res) => {
    const recruiterId = req.params.recruiterId?.trim();
    if (!recruiterId)
        return res.status(400).json({ error: 'Recruiter is required' });
    if (req.auth.userId !== recruiterId) {
        return res.status(403).json({ error: 'You can only accept your own assignment' });
    }
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const recruiters = JSON.parse(existing.recruiters || '[]');
    const pending = JSON.parse(existing.pendingRecruiters || '[]');
    if (!pending.includes(recruiterId)) {
        if (recruiters.includes(recruiterId))
            return res.json(mapRequirement(existing));
        return res.status(400).json({ error: 'No pending invitation for this recruiter' });
    }
    const nextPending = pending.filter((id) => id !== recruiterId);
    if (!recruiters.includes(recruiterId))
        recruiters.push(recruiterId);
    const timestamp = new Date().toISOString();
    const approvalHistory = JSON.parse(existing.approvalHistory || '[]');
    approvalHistory.push({
        action: 'RECRUITER_ASSIGNED',
        by: req.auth.userId,
        at: timestamp,
        role: req.auth.role,
        recruiterId,
    });
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            recruiters: JSON.stringify(recruiters),
            pendingRecruiters: JSON.stringify(nextPending),
            approvalHistory: JSON.stringify(approvalHistory),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'RECRUITER_ASSIGNED',
        performedBy: req.auth.userId,
        details: { recruiterId },
    });
    res.json(mapRequirement(row));
});
router.post('/:id/assign-recruiter/:recruiterId/reject', requireRoles('RECRUITER'), async (req, res) => {
    const recruiterId = req.params.recruiterId?.trim();
    if (!recruiterId)
        return res.status(400).json({ error: 'Recruiter is required' });
    if (req.auth.userId !== recruiterId) {
        return res.status(403).json({ error: 'You can only reject your own assignment' });
    }
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const pending = JSON.parse(existing.pendingRecruiters || '[]');
    if (!pending.includes(recruiterId)) {
        return res.status(400).json({ error: 'No pending invitation for this recruiter' });
    }
    const nextPending = pending.filter((id) => id !== recruiterId);
    const timestamp = new Date().toISOString();
    const approvalHistory = JSON.parse(existing.approvalHistory || '[]');
    approvalHistory.push({
        action: 'RECRUITER_ASSIGNMENT_REJECTED',
        by: req.auth.userId,
        at: timestamp,
        role: req.auth.role,
        recruiterId,
    });
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            pendingRecruiters: JSON.stringify(nextPending),
            approvalHistory: JSON.stringify(approvalHistory),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'RECRUITER_ASSIGNMENT_REJECTED',
        performedBy: req.auth.userId,
        details: { recruiterId },
    });
    res.json(mapRequirement(row));
});
router.delete('/:id/assign-recruiter/:recruiterId', requireRoles(...REQUIREMENT_ASSIGNMENT_ROLES), async (req, res) => {
    const recruiterId = req.params.recruiterId?.trim();
    if (!recruiterId)
        return res.status(400).json({ error: 'Recruiter is required' });
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const recruiters = JSON.parse(existing.recruiters || '[]');
    const pending = JSON.parse(existing.pendingRecruiters || '[]');
    const wasAssigned = recruiters.includes(recruiterId);
    const wasPending = pending.includes(recruiterId);
    if (!wasAssigned && !wasPending) {
        return res.status(404).json({ error: 'Recruiter is not assigned to this requirement' });
    }
    const nextRecruiters = recruiters.filter((id) => id !== recruiterId);
    const nextPending = pending.filter((id) => id !== recruiterId);
    const timestamp = new Date().toISOString();
    const approvalHistory = JSON.parse(existing.approvalHistory || '[]');
    approvalHistory.push({
        action: 'RECRUITER_UNASSIGNED',
        by: req.auth.userId,
        at: timestamp,
        role: req.auth.role,
        recruiterId,
    });
    const row = await prisma.requirement.update({
        where: { id: req.params.id },
        data: {
            recruiters: JSON.stringify(nextRecruiters),
            pendingRecruiters: JSON.stringify(nextPending),
            approvalHistory: JSON.stringify(approvalHistory),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'REQUIREMENT',
        entityId: row.id,
        action: 'RECRUITER_UNASSIGNED',
        performedBy: req.auth.userId,
        details: { recruiterId, wasPending },
    });
    res.json(mapRequirement(row));
});
router.delete('/:id', requireRoles('ADMIN'), async (req, res) => {
    const existing = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const interviews = await prisma.interview.findMany({
        where: { requirementId: req.params.id },
        select: { id: true },
    });
    const interviewIds = interviews.map((i) => i.id);
    await prisma.$transaction([
        prisma.feedback.deleteMany({ where: { interviewId: { in: interviewIds } } }),
        prisma.interview.deleteMany({ where: { requirementId: req.params.id } }),
        prisma.offer.deleteMany({ where: { requirementId: req.params.id } }),
        prisma.candidate.updateMany({
            where: { requirementId: req.params.id },
            data: { requirementId: null, updatedAt: new Date() },
        }),
        prisma.activityLog.deleteMany({
            where: { entityType: 'REQUIREMENT', entityId: req.params.id },
        }),
        prisma.interviewPlan.deleteMany({ where: { requirementId: req.params.id } }),
    ]);
    await prisma.requirement.delete({ where: { id: req.params.id } });
    res.status(204).send();
});
function pickRequirementFields(data) {
    const allowed = [
        'client',
        'title',
        'department',
        'hiringManager',
        'status',
        'openings',
        'filled',
        'priority',
        'location',
        'locationCity',
        'isRemote',
        'workMode',
        'employmentType',
        'seniorityLevel',
        'experienceMinYears',
        'experienceMaxYears',
        'salaryBand',
        'targetStartDate',
        'hiringDeadline',
        'description',
        'jobDescription',
        'primarySkills',
        'secondarySkills',
        'visibleToCandidates',
    ];
    const out = {};
    for (const k of allowed) {
        if (data[k] !== undefined)
            out[k] = data[k];
    }
    if (data.primarySkills !== undefined) {
        out.primarySkills = serializeSkills(parseSkillList(data.primarySkills));
    }
    if (data.secondarySkills !== undefined) {
        out.secondarySkills = serializeSkills(parseSkillList(data.secondarySkills));
    }
    if (data.targetStartDate !== undefined) {
        out.targetStartDate =
            data.targetStartDate === null || data.targetStartDate === ''
                ? null
                : new Date(String(data.targetStartDate));
    }
    if (data.hiringDeadline !== undefined) {
        out.hiringDeadline =
            data.hiringDeadline === null || data.hiringDeadline === ''
                ? null
                : new Date(String(data.hiringDeadline));
    }
    if (data.isRemote !== undefined)
        out.isRemote = Boolean(data.isRemote);
    return out;
}
export default router;
