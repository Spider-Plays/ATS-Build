import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { mapCandidate } from '../utils/mappers.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { logActivity } from '../services/activityLog.js';
import { INTERNAL_ROLES, STAFF_MUTATE } from '../lib/roles.js';
import { refreshRequirementHiringState, syncRequirementHiringState } from '../lib/hiring.js';
import { isRequirementAcceptingCandidates, requirementApplicationsClosedMessage, } from '../lib/requirementHiring.js';
import { handleUploadResume } from '../middleware/uploadResume.js';
import { deleteResumeFile, isAllowedResumeFile, resolveResumeMime, saveResumeFile, } from '../lib/resumeStorage.js';
import { loadCandidateResume } from '../lib/candidateResume.js';
import { DUPLICATE_CANDIDATE_EMAIL_MESSAGE, DUPLICATE_CANDIDATE_PAN_MESSAGE, findCandidateByEmail, findCandidateByPan, isValidPanFormat, } from '../lib/candidateDuplicate.js';
import { buildCandidateResumePayload, extractResumeText, parseResumeFields, } from '../lib/resumeParse.js';
import { getCatalogSkillNames } from '../lib/skillCatalog.js';
import { serializeSkills, parseSkillList } from '../lib/skills.js';
import { computeMatchScore, computeCandidateRequirementMatch, loadCandidateResumeText, } from '../lib/profileMatching.js';
import { assertCanMutateCandidate, assertCanViewCandidate, buildCandidateListWhere, CandidateAccessError, } from '../lib/candidateAccess.js';
import { assertCanAddCandidatesToRequirement, assertCanViewRequirement, RequirementAccessError, } from '../lib/requirementAccess.js';
import { assertCanChangeCandidateStatus } from '../lib/candidateStagePermissions.js';
import { buildRequirementTagUpdate, isCandidatePipelineStatus, isJoinedStatus, repairLinkedCandidateStatuses, resolveCreateStatus, } from '../lib/candidateStatuses.js';
import { notifyCandidateStatusChange, notifyNewCandidate } from '../lib/emailDispatch.js';
import { isEmailConfigured, sendJobDescriptionEmail } from '../services/email.js';
import { buildCandidateSearchIndexFields, parseCtcLakhs, } from '../lib/candidateFieldNormalize.js';
import { CandidateSearchQueryError, executeCandidateSearch, parseCandidateSearchQuery, } from '../lib/candidateSearch.js';
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
const referrerSelect = {
    id: true,
    name: true,
    email: true,
    referralCode: true,
    department: true,
};
async function loadReferrersById(ids) {
    const unique = [...new Set(ids.filter((id) => !!id))];
    if (!unique.length)
        return new Map();
    const users = await prisma.user.findMany({
        where: { id: { in: unique } },
        select: referrerSelect,
    });
    return new Map(users.map((u) => [u.id, u]));
}
router.get('/search', async (req, res) => {
    if (req.auth.role === 'INTERVIEWER') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const params = parseCandidateSearchQuery(req.query);
        const result = await executeCandidateSearch(req.auth, params);
        if (result.ids.length === 0) {
            return res.json({
                items: [],
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                headlines: {},
            });
        }
        const rows = await prisma.candidate.findMany({
            where: { id: { in: result.ids } },
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered = result.ids.map((id) => byId.get(id)).filter(Boolean);
        const requirementIds = [
            ...new Set(ordered.map((r) => r.requirementId).filter((id) => !!id)),
        ];
        const creatorIds = [
            ...new Set(ordered.map((r) => r.createdBy).filter((id) => !!id)),
        ];
        const [requirements, recruiters, referrerById] = await Promise.all([
            requirementIds.length
                ? prisma.requirement.findMany({
                    where: { id: { in: requirementIds } },
                    select: { id: true, jobCode: true, client: true, title: true },
                })
                : [],
            creatorIds.length
                ? prisma.user.findMany({
                    where: { id: { in: creatorIds } },
                    select: { id: true, name: true },
                })
                : [],
            loadReferrersById(ordered.map((r) => r.referredByUserId)),
        ]);
        const reqById = new Map(requirements.map((r) => [r.id, r]));
        const recruiterById = new Map(recruiters.map((u) => [u.id, u]));
        const pageHeadlines = {};
        for (const id of result.ids) {
            if (result.headlines[id])
                pageHeadlines[id] = result.headlines[id];
        }
        res.json({
            items: ordered.map((c) => mapCandidate(c, {
                requirement: c.requirementId ? reqById.get(c.requirementId) : undefined,
                recruiter: c.createdBy ? recruiterById.get(c.createdBy) : undefined,
                referrer: c.referredByUserId ? referrerById.get(c.referredByUserId) : undefined,
            })),
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            headlines: pageHeadlines,
        });
    }
    catch (err) {
        if (err instanceof CandidateSearchQueryError) {
            return res.status(400).json({ error: err.message });
        }
        console.error('Candidate search failed:', err);
        res.status(500).json({ error: 'Failed to search candidates' });
    }
});
router.get('/', async (req, res) => {
    if (req.auth.role === 'INTERVIEWER') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        const auth = req.auth;
        const listWhere = await buildCandidateListWhere(auth);
        await repairLinkedCandidateStatuses();
        const rows = await prisma.candidate.findMany({
            where: listWhere,
            orderBy: [{ appliedDate: 'desc' }, { createdAt: 'desc' }],
        });
        const requirementIds = [
            ...new Set(rows.map((r) => r.requirementId).filter((id) => !!id)),
        ];
        const creatorIds = [
            ...new Set(rows.map((r) => r.createdBy).filter((id) => !!id)),
        ];
        const [requirements, recruiters, referrerById] = await Promise.all([
            requirementIds.length
                ? prisma.requirement.findMany({
                    where: { id: { in: requirementIds } },
                    select: { id: true, jobCode: true, client: true, title: true },
                })
                : [],
            creatorIds.length
                ? prisma.user.findMany({
                    where: { id: { in: creatorIds } },
                    select: { id: true, name: true },
                })
                : [],
            loadReferrersById(rows.map((r) => r.referredByUserId)),
        ]);
        const reqById = new Map(requirements.map((r) => [r.id, r]));
        const recruiterById = new Map(recruiters.map((u) => [u.id, u]));
        res.json(rows.map((c) => mapCandidate(c, {
            requirement: c.requirementId ? reqById.get(c.requirementId) ?? null : null,
            recruiter: c.createdBy ? recruiterById.get(c.createdBy) ?? null : null,
            referrer: c.referredByUserId
                ? referrerById.get(c.referredByUserId) ?? null
                : null,
        })));
    }
    catch (err) {
        console.error('List candidates failed:', err);
        const message = err instanceof Error && err.message.includes('does not exist')
            ? 'Database schema is out of date. Restart the API server or run: cd server && npx prisma db push'
            : 'Failed to load candidates';
        res.status(500).json({ error: message });
    }
});
router.get('/by-requirement/:requirementId', async (req, res) => {
    try {
        await assertCanViewRequirement(req.auth, req.params.requirementId);
    }
    catch (err) {
        if (err instanceof RequirementAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const listWhere = await buildCandidateListWhere(req.auth);
    await repairLinkedCandidateStatuses({ requirementId: req.params.requirementId });
    const rows = await prisma.candidate.findMany({
        where: {
            requirementId: req.params.requirementId,
            ...listWhere,
        },
        orderBy: { appliedDate: 'desc' },
    });
    res.json(rows.map((c) => mapCandidate(c)));
});
router.post('/parse-resume', requireRoles(...STAFF_MUTATE), handleUploadResume, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Resume file is required' });
        }
        const text = await extractResumeText(req.file.buffer, req.file.mimetype, req.file.originalname);
        if (!text) {
            return res.status(422).json({
                error: 'No readable text found in this resume. Enter details manually.',
            });
        }
        const catalog = await getCatalogSkillNames();
        const fields = parseResumeFields(text, catalog);
        res.json({ fields });
    }
    catch (err) {
        console.error('Resume parse failed:', err);
        const message = err instanceof Error ? err.message : 'Could not parse resume';
        res.status(422).json({ error: message });
    }
});
router.get('/check-email', async (req, res) => {
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    if (!email.trim()) {
        return res.json({ exists: false });
    }
    const existing = await findCandidateByEmail(email);
    if (!existing) {
        return res.json({ exists: false });
    }
    res.json({
        exists: true,
        candidateId: existing.id,
        name: existing.name,
        error: DUPLICATE_CANDIDATE_EMAIL_MESSAGE,
    });
});
router.get('/check-pan', async (req, res) => {
    const pan = typeof req.query.pan === 'string' ? req.query.pan : '';
    const excludeId = typeof req.query.excludeId === 'string' ? req.query.excludeId.trim() : undefined;
    if (!pan.trim() || !isValidPanFormat(pan)) {
        return res.json({ exists: false });
    }
    const existing = await findCandidateByPan(pan, excludeId);
    if (!existing) {
        return res.json({ exists: false });
    }
    res.json({
        exists: true,
        candidateId: existing.id,
        name: existing.name,
        error: DUPLICATE_CANDIDATE_PAN_MESSAGE,
    });
});
router.get('/:id/resume', async (req, res) => {
    try {
        await assertCanViewCandidate(req.auth, req.params.id);
        const row = await prisma.candidate.findUnique({ where: { id: req.params.id } });
        if (!row)
            return res.status(404).json({ error: 'Not found' });
        if (!row.resumeFileName)
            return res.status(404).json({ error: 'No resume uploaded' });
        const loaded = await loadCandidateResume(row);
        if (!loaded)
            return res.status(404).json({ error: 'Resume file missing' });
        res.setHeader('Content-Type', loaded.mime);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(loaded.fileName)}"`);
        res.send(loaded.buffer);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        console.error('Resume download failed:', err);
        res.status(500).json({ error: 'Failed to load resume' });
    }
});
router.post('/:id/resume', requireRoles(...STAFF_MUTATE), handleUploadResume, async (req, res) => {
    try {
        await assertCanMutateCandidate(req.auth, req.params.id);
        const row = await prisma.candidate.findUnique({ where: { id: req.params.id } });
        if (!row)
            return res.status(404).json({ error: 'Not found' });
        if (!req.file)
            return res.status(400).json({ error: 'Resume file is required' });
        if (!isAllowedResumeFile(req.file.mimetype, req.file.originalname)) {
            return res.status(400).json({ error: 'Only PDF, DOC, and DOCX files are allowed' });
        }
        const mime = resolveResumeMime(req.file.mimetype, req.file.originalname);
        const stored = await saveResumeFile(row.id, mime, req.file.buffer, req.file.originalname, row.resumeStorageKey);
        let resumePayload = {
            resumeText: null,
            primarySkills: '[]',
            secondarySkills: '[]',
        };
        try {
            const text = await extractResumeText(req.file.buffer, req.file.mimetype, req.file.originalname);
            const catalog = await getCatalogSkillNames();
            resumePayload = buildCandidateResumePayload(text, catalog);
        }
        catch {
            /* keep file without text extraction */
        }
        let updated = await prisma.candidate.update({
            where: { id: row.id },
            data: {
                resumeFileName: req.file.originalname,
                resumeMimeType: mime,
                resumeUrl: null,
                resumeStorageKey: null,
                resumeText: resumePayload.resumeText,
                primarySkills: resumePayload.primarySkills,
                secondarySkills: resumePayload.secondarySkills,
                ...buildCandidateSearchIndexFields({
                    name: row.name,
                    email: row.email,
                    role: row.role,
                    jobTitle: row.jobTitle,
                    location: row.location,
                    currentCompany: row.currentCompany,
                    primarySkills: resumePayload.primarySkills,
                    secondarySkills: resumePayload.secondarySkills,
                    resumeText: resumePayload.resumeText,
                    totalExperience: row.totalExperience,
                    currentCTC: row.currentCTC,
                    expectedCTC: row.expectedCTC,
                    noticePeriod: row.noticePeriod,
                }),
                updatedAt: new Date(),
            },
        });
        if (updated.requirementId && resumePayload.resumeText) {
            const requirement = await prisma.requirement.findUnique({
                where: { id: updated.requirementId },
            });
            if (requirement) {
                const catalog = await getCatalogSkillNames();
                const { score } = computeMatchScore(updated, requirement, resumePayload.resumeText, catalog);
                updated = await prisma.candidate.update({
                    where: { id: row.id },
                    data: { matchScore: score, updatedAt: new Date() },
                });
            }
        }
        await logActivity({
            entityType: 'CANDIDATE',
            entityId: row.id,
            action: 'RESUME_UPLOADED',
            performedBy: req.auth.userId,
            details: { fileName: req.file.originalname },
        });
        res.json(mapCandidate(updated));
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        console.error('Resume upload failed:', err);
        const message = err instanceof Error ? err.message : 'Failed to save resume';
        res.status(500).json({ error: message });
    }
});
router.delete('/:id/resume', async (req, res) => {
    try {
        await assertCanMutateCandidate(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const row = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Not found' });
    await deleteResumeFile(row.id, row.resumeStorageKey);
    const updated = await prisma.candidate.update({
        where: { id: row.id },
        data: {
            resumeFileName: null,
            resumeMimeType: null,
            resumeUrl: null,
            resumeStorageKey: null,
            updatedAt: new Date(),
        },
    });
    res.json(mapCandidate(updated));
});
router.get('/:id/match-breakdown', async (req, res) => {
    try {
        await assertCanViewCandidate(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const candidate = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!candidate)
        return res.status(404).json({ error: 'Not found' });
    if (!candidate.requirementId) {
        return res.status(422).json({ error: 'Candidate is not linked to a requirement.' });
    }
    const requirement = await prisma.requirement.findUnique({
        where: { id: candidate.requirementId },
    });
    if (!requirement)
        return res.status(404).json({ error: 'Requirement not found' });
    const catalog = await getCatalogSkillNames();
    const { score, breakdown } = await computeCandidateRequirementMatch(candidate, requirement, catalog);
    if (Math.round(candidate.matchScore) !== score) {
        await prisma.candidate.update({
            where: { id: candidate.id },
            data: { matchScore: score, updatedAt: new Date() },
        });
    }
    res.json({
        matchScore: score,
        breakdown,
        requirement: {
            id: requirement.id,
            title: requirement.title,
            jobCode: requirement.jobCode,
        },
    });
});
router.get('/:id', async (req, res) => {
    try {
        await assertCanViewCandidate(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    await repairLinkedCandidateStatuses({ candidateIds: [req.params.id] });
    const row = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Not found' });
    const [requirement, recruiter, referrer] = await Promise.all([
        row.requirementId
            ? prisma.requirement.findUnique({
                where: { id: row.requirementId },
                select: { id: true, jobCode: true, client: true, title: true },
            })
            : null,
        row.createdBy
            ? prisma.user.findUnique({
                where: { id: row.createdBy },
                select: { id: true, name: true },
            })
            : null,
        row.referredByUserId
            ? prisma.user.findUnique({
                where: { id: row.referredByUserId },
                select: referrerSelect,
            })
            : null,
    ]);
    res.json(mapCandidate(row, { requirement, recruiter, referrer }));
});
router.post('/', requireRoles(...STAFF_MUTATE), async (req, res) => {
    const body = req.body;
    if (!body.email?.trim()) {
        return res.status(400).json({ error: 'Email is required' });
    }
    const duplicate = await findCandidateByEmail(body.email);
    if (duplicate) {
        return res.status(409).json({
            error: DUPLICATE_CANDIDATE_EMAIL_MESSAGE,
            existingCandidateId: duplicate.id,
        });
    }
    if (body.pan?.trim()) {
        const duplicatePan = await findCandidateByPan(body.pan);
        if (duplicatePan) {
            return res.status(409).json({
                error: DUPLICATE_CANDIDATE_PAN_MESSAGE,
                existingCandidateId: duplicatePan.id,
            });
        }
    }
    const requirementId = body.requirementId || null;
    let matchScore = typeof body.matchScore === 'number' ? body.matchScore : 0;
    const initialStatus = resolveCreateStatus(requirementId);
    const createStatus = typeof body.status === 'string' && isCandidatePipelineStatus(body.status)
        ? body.status
        : initialStatus;
    if (requirementId) {
        try {
            await assertCanAddCandidatesToRequirement(req.auth, requirementId);
        }
        catch (err) {
            if (err instanceof RequirementAccessError) {
                return res.status(403).json({ error: err.message });
            }
            throw err;
        }
        let requirement = await prisma.requirement.findUnique({
            where: { id: requirementId },
        });
        if (!requirement) {
            return res.status(404).json({ error: 'Requirement not found' });
        }
        requirement = (await refreshRequirementHiringState(requirementId)) ?? requirement;
        if (!isRequirementAcceptingCandidates(requirement)) {
            return res.status(400).json({
                error: requirementApplicationsClosedMessage(requirement),
            });
        }
        const resumeText = typeof body.resumeText === 'string' ? body.resumeText : '';
        const skillCorpus = [
            ...parseSkillList(body.primarySkills),
            ...parseSkillList(body.secondarySkills),
        ].join(' ');
        const draft = {
            id: 'draft',
            name: body.name,
            email: body.email,
            role: body.role,
            status: createStatus,
            matchScore: 0,
            source: body.source ?? 'Direct',
            appliedDate: new Date(),
            requirementId: null,
            jobTitle: null,
            createdBy: req.auth.userId,
            avatar: null,
            resumeUrl: null,
            resumeFileName: null,
            resumeMimeType: null,
            phone: body.phone ?? null,
            location: body.location ?? null,
            linkedIn: body.linkedIn ?? null,
            portfolio: body.portfolio ?? null,
            totalExperience: body.totalExperience ?? null,
            currentCompany: body.currentCompany ?? null,
            currentCTC: body.currentCTC ?? null,
            expectedCTC: body.expectedCTC ?? null,
            noticePeriod: body.noticePeriod ?? null,
            pan: body.pan?.trim()?.toUpperCase() || null,
            vendorId: null,
            submittedByUserId: null,
            primarySkills: serializeSkills(parseSkillList(body.primarySkills)),
            secondarySkills: serializeSkills(parseSkillList(body.secondarySkills)),
            resumeText: resumeText || null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const catalog = await getCatalogSkillNames();
        matchScore = computeMatchScore(draft, requirement, [resumeText, skillCorpus].filter(Boolean).join('\n'), catalog).score;
    }
    const row = await prisma.candidate.create({
        data: {
            name: body.name,
            email: body.email,
            role: body.role,
            status: createStatus,
            matchScore,
            source: body.source ?? 'Direct',
            requirementId,
            jobTitle: body.jobTitle,
            submittedAt: requirementId ? new Date() : null,
            avatar: body.avatar,
            phone: body.phone,
            location: body.location,
            linkedIn: body.linkedIn,
            portfolio: body.portfolio,
            totalExperience: body.totalExperience,
            currentCompany: body.currentCompany,
            currentCTC: body.currentCTC,
            expectedCTC: body.expectedCTC,
            noticePeriod: body.noticePeriod,
            pan: body.pan?.trim()?.toUpperCase() || null,
            primarySkills: serializeSkills(parseSkillList(body.primarySkills)),
            secondarySkills: serializeSkills(parseSkillList(body.secondarySkills)),
            resumeText: typeof body.resumeText === 'string' ? body.resumeText : null,
            createdBy: req.auth.userId,
            ...buildCandidateSearchIndexFields({
                name: body.name,
                email: body.email,
                role: body.role,
                jobTitle: body.jobTitle,
                location: body.location,
                currentCompany: body.currentCompany,
                primarySkills: serializeSkills(parseSkillList(body.primarySkills)),
                secondarySkills: serializeSkills(parseSkillList(body.secondarySkills)),
                resumeText: typeof body.resumeText === 'string' ? body.resumeText : null,
                totalExperience: body.totalExperience,
                currentCTC: body.currentCTC,
                expectedCTC: body.expectedCTC,
                noticePeriod: body.noticePeriod,
            }),
        },
    });
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: row.id,
        action: 'CREATED',
        performedBy: req.auth.userId,
        details: { name: body.name, role: body.role },
    });
    const creator = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { name: true },
    });
    notifyNewCandidate({
        id: row.id,
        name: row.name,
        email: row.email,
        jobTitle: row.jobTitle,
        requirementId: row.requirementId,
        source: row.source,
    }, { submittedBy: creator?.name });
    if (row.requirementId)
        await syncRequirementHiringState(row.requirementId);
    res.status(201).json(mapCandidate(row));
});
router.patch('/:id', requireRoles(...STAFF_MUTATE), async (req, res) => {
    try {
        await assertCanMutateCandidate(req.auth, req.params.id);
        const b = req.body;
        const existing = await prisma.candidate.findUnique({ where: { id: req.params.id } });
        if (!existing)
            return res.status(404).json({ error: 'Not found' });
        if (b.email !== undefined) {
            const duplicate = await findCandidateByEmail(b.email, req.params.id);
            if (duplicate) {
                return res.status(409).json({
                    error: DUPLICATE_CANDIDATE_EMAIL_MESSAGE,
                    existingCandidateId: duplicate.id,
                });
            }
        }
        if (b.pan !== undefined && b.pan?.trim()) {
            const duplicatePan = await findCandidateByPan(b.pan, req.params.id);
            if (duplicatePan) {
                return res.status(409).json({
                    error: DUPLICATE_CANDIDATE_PAN_MESSAGE,
                    existingCandidateId: duplicatePan.id,
                });
            }
        }
        const primarySkills = b.primarySkills !== undefined
            ? serializeSkills(parseSkillList(b.primarySkills))
            : undefined;
        const secondarySkills = b.secondarySkills !== undefined
            ? serializeSkills(parseSkillList(b.secondarySkills))
            : undefined;
        const nextRequirementId = b.requirementId !== undefined
            ? b.requirementId === '' || b.requirementId === null
                ? null
                : b.requirementId
            : existing.requirementId;
        if (b.requirementId !== undefined &&
            nextRequirementId &&
            nextRequirementId !== existing.requirementId) {
            try {
                await assertCanAddCandidatesToRequirement(req.auth, nextRequirementId);
            }
            catch (err) {
                if (err instanceof RequirementAccessError) {
                    return res.status(403).json({ error: err.message });
                }
                throw err;
            }
            const targetRequirement = await prisma.requirement.findUnique({
                where: { id: nextRequirementId },
            });
            if (!targetRequirement) {
                return res.status(404).json({ error: 'Requirement not found' });
            }
            if (!isRequirementAcceptingCandidates(targetRequirement)) {
                return res.status(400).json({
                    error: requirementApplicationsClosedMessage(targetRequirement),
                });
            }
            const duplicateOnRequirement = await prisma.candidate.findFirst({
                where: {
                    requirementId: nextRequirementId,
                    email: { equals: existing.email, mode: 'insensitive' },
                    id: { not: req.params.id },
                },
                select: { id: true },
            });
            if (duplicateOnRequirement) {
                return res.status(409).json({
                    error: 'A candidate with this email is already linked to that requirement.',
                });
            }
        }
        let matchScore = b.matchScore !== undefined ? b.matchScore : undefined;
        const shouldRecalcMatch = b.requirementId !== undefined ||
            b.primarySkills !== undefined ||
            b.secondarySkills !== undefined;
        if (shouldRecalcMatch && nextRequirementId) {
            const requirement = await prisma.requirement.findUnique({
                where: { id: nextRequirementId },
            });
            if (requirement) {
                const merged = {
                    ...existing,
                    primarySkills: primarySkills ?? existing.primarySkills,
                    secondarySkills: secondarySkills ?? existing.secondarySkills,
                    requirementId: nextRequirementId,
                };
                const resumeText = await loadCandidateResumeText(merged);
                const catalog = await getCatalogSkillNames();
                matchScore = computeMatchScore(merged, requirement, resumeText, catalog).score;
            }
        }
        let nextJobTitle = b.jobTitle;
        if (b.requirementId !== undefined &&
            nextRequirementId &&
            b.jobTitle === undefined &&
            nextRequirementId !== existing.requirementId) {
            const requirement = await prisma.requirement.findUnique({
                where: { id: nextRequirementId },
                select: { title: true },
            });
            if (requirement)
                nextJobTitle = requirement.title;
        }
        const requirementTagUpdate = b.requirementId !== undefined
            ? buildRequirementTagUpdate(existing.status, existing.requirementId, nextRequirementId)
            : {};
        const mergedForSearch = {
            name: b.name !== undefined ? b.name : existing.name,
            email: b.email !== undefined ? b.email : existing.email,
            role: b.role !== undefined ? b.role : existing.role,
            jobTitle: nextJobTitle !== undefined ? nextJobTitle : existing.jobTitle,
            location: b.location !== undefined ? b.location : existing.location,
            currentCompany: b.currentCompany !== undefined ? b.currentCompany : existing.currentCompany,
            primarySkills: primarySkills ?? existing.primarySkills,
            secondarySkills: secondarySkills ?? existing.secondarySkills,
            resumeText: existing.resumeText,
            totalExperience: b.totalExperience !== undefined ? b.totalExperience : existing.totalExperience,
            currentCTC: b.currentCTC !== undefined ? b.currentCTC : existing.currentCTC,
            expectedCTC: b.expectedCTC !== undefined ? b.expectedCTC : existing.expectedCTC,
            noticePeriod: b.noticePeriod !== undefined ? b.noticePeriod : existing.noticePeriod,
        };
        const row = await prisma.candidate.update({
            where: { id: req.params.id },
            data: {
                ...(b.name !== undefined && { name: b.name }),
                ...(b.email !== undefined && { email: b.email }),
                ...(b.role !== undefined && { role: b.role }),
                ...(b.status !== undefined && { status: b.status }),
                ...(b.status === undefined && requirementTagUpdate.status && { status: requirementTagUpdate.status }),
                ...(requirementTagUpdate.submittedAt !== undefined && {
                    submittedAt: requirementTagUpdate.submittedAt,
                }),
                ...(matchScore !== undefined && { matchScore }),
                ...(b.source !== undefined && { source: b.source }),
                ...(b.requirementId !== undefined && { requirementId: nextRequirementId }),
                ...(nextJobTitle !== undefined && { jobTitle: nextJobTitle }),
                ...(b.avatar !== undefined && { avatar: b.avatar }),
                ...(b.phone !== undefined && { phone: b.phone }),
                ...(b.location !== undefined && { location: b.location }),
                ...(b.linkedIn !== undefined && { linkedIn: b.linkedIn }),
                ...(b.portfolio !== undefined && { portfolio: b.portfolio }),
                ...(b.totalExperience !== undefined && { totalExperience: b.totalExperience }),
                ...(b.currentCompany !== undefined && { currentCompany: b.currentCompany }),
                ...(b.currentCTC !== undefined && { currentCTC: b.currentCTC }),
                ...(b.expectedCTC !== undefined && { expectedCTC: b.expectedCTC }),
                ...(b.noticePeriod !== undefined && { noticePeriod: b.noticePeriod }),
                ...(b.pan !== undefined && {
                    pan: b.pan?.trim() ? b.pan.trim().toUpperCase() : null,
                }),
                ...(primarySkills !== undefined && { primarySkills }),
                ...(secondarySkills !== undefined && { secondarySkills }),
                ...buildCandidateSearchIndexFields(mergedForSearch),
                updatedAt: new Date(),
            },
        });
        if (existing.requirementId && existing.requirementId !== row.requirementId) {
            await syncRequirementHiringState(existing.requirementId);
        }
        if (row.requirementId) {
            await syncRequirementHiringState(row.requirementId);
        }
        const [requirement, recruiter, referrer] = await Promise.all([
            row.requirementId
                ? prisma.requirement.findUnique({
                    where: { id: row.requirementId },
                    select: { id: true, jobCode: true, client: true, title: true },
                })
                : null,
            row.createdBy
                ? prisma.user.findUnique({
                    where: { id: row.createdBy },
                    select: { id: true, name: true },
                })
                : null,
            row.referredByUserId
                ? prisma.user.findUnique({
                    where: { id: row.referredByUserId },
                    select: referrerSelect,
                })
                : null,
        ]);
        await logActivity({
            entityType: 'CANDIDATE',
            entityId: row.id,
            action: 'UPDATED',
            performedBy: req.auth.userId,
            details: Object.keys(req.body),
        });
        const statusChanged = row.status !== existing.status &&
            (b.status !== undefined || requirementTagUpdate.status !== undefined);
        if (statusChanged) {
            await logActivity({
                entityType: 'CANDIDATE',
                entityId: row.id,
                action: 'STATUS_CHANGED',
                performedBy: req.auth.userId,
                details: {
                    name: row.name,
                    jobTitle: row.jobTitle ?? row.role,
                    previousStatus: existing.status,
                    newStatus: row.status,
                },
            });
            notifyCandidateStatusChange({
                id: row.id,
                email: row.email,
                name: row.name,
                status: row.status,
                jobTitle: row.jobTitle,
                requirementId: row.requirementId,
                referredByUserId: row.referredByUserId,
            }, existing.status);
        }
        res.json(mapCandidate(row, { requirement, recruiter, referrer }));
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        console.error('Candidate update failed:', err);
        res.status(500).json({ error: 'Failed to update candidate' });
    }
});
function parseDateField(value, label) {
    if (value == null || value === '')
        return null;
    if (typeof value !== 'string') {
        throw new Error(`Invalid ${label}`);
    }
    const d = new Date(`${value}T12:00:00`);
    if (Number.isNaN(d.getTime()))
        throw new Error(`Invalid ${label}`);
    return d;
}
router.patch('/:id/status', requireRoles(...STAFF_MUTATE), async (req, res) => {
    try {
        await assertCanMutateCandidate(req.auth, req.params.id);
        const { status, milestone } = req.body;
        if (!status || typeof status !== 'string') {
            return res.status(400).json({ error: 'Status is required' });
        }
        if (!isCandidatePipelineStatus(status)) {
            return res.status(400).json({ error: 'Invalid pipeline status' });
        }
        const existing = await prisma.candidate.findUnique({
            where: { id: req.params.id },
            select: {
                status: true,
                email: true,
                name: true,
                jobTitle: true,
                requirementId: true,
                referredByUserId: true,
            },
        });
        if (!existing) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        try {
            assertCanChangeCandidateStatus(existing.status, status, req.auth.role);
        }
        catch (e) {
            return res.status(403).json({
                error: e instanceof Error ? e.message : 'Cannot change status',
            });
        }
        const data = { status, updatedAt: new Date() };
        const activityDetails = {
            previousStatus: existing.status,
            newStatus: status,
        };
        if (status === 'TO_BE_OFFERED' || status === 'OFFERED') {
            const expectedCTC = milestone?.expectedCTC?.trim();
            if (!expectedCTC || !milestone?.offerMonth || !milestone?.offerQuarter) {
                return res.status(400).json({ error: 'Expected CTC, month, and quarter are required' });
            }
            if (!milestone.expectedJoiningDate) {
                return res.status(400).json({ error: 'Expected joining date is required' });
            }
            data.expectedCTC = expectedCTC;
            data.expectedCtcLakhs = parseCtcLakhs(expectedCTC);
            data.offerMonth = milestone.offerMonth;
            data.offerQuarter = milestone.offerQuarter;
            data.expectedJoiningDate = parseDateField(milestone.expectedJoiningDate, 'expected joining date');
            activityDetails.expectedCTC = expectedCTC;
            activityDetails.offerMonth = milestone.offerMonth;
            activityDetails.offerQuarter = milestone.offerQuarter;
            activityDetails.expectedJoiningDate = milestone.expectedJoiningDate;
        }
        else if (status === 'JOINED') {
            if (!milestone?.joiningDate || !milestone?.joiningMonth || !milestone?.joiningQuarter) {
                return res.status(400).json({ error: 'Joining date, month, and quarter are required' });
            }
            data.joiningDate = parseDateField(milestone.joiningDate, 'joining date');
            data.joiningMonth = milestone.joiningMonth;
            data.joiningQuarter = milestone.joiningQuarter;
            activityDetails.joiningDate = milestone.joiningDate;
            activityDetails.joiningMonth = milestone.joiningMonth;
            activityDetails.joiningQuarter = milestone.joiningQuarter;
        }
        const row = await prisma.candidate.update({
            where: { id: req.params.id },
            data,
        });
        if (isJoinedStatus(status) && row.requirementId) {
            await syncRequirementHiringState(row.requirementId);
        }
        await logActivity({
            entityType: 'CANDIDATE',
            entityId: row.id,
            action: 'STATUS_CHANGED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: activityDetails,
        });
        notifyCandidateStatusChange({
            id: row.id,
            email: row.email,
            name: row.name,
            status: row.status,
            jobTitle: row.jobTitle,
            requirementId: row.requirementId,
            referredByUserId: row.referredByUserId,
        }, existing.status);
        res.json(mapCandidate(row));
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        const msg = err instanceof Error ? err.message : 'Failed to update status';
        res.status(400).json({ error: msg });
    }
});
router.post('/:id/send-jd', requireRoles(...STAFF_MUTATE), async (req, res) => {
    try {
        await assertCanMutateCandidate(req.auth, req.params.id);
        const row = await prisma.candidate.findUnique({ where: { id: req.params.id } });
        if (!row)
            return res.status(404).json({ error: 'Not found' });
        if (!row.requirementId) {
            return res.status(400).json({
                error: 'Tag this candidate to a job requirement before sending the JD.',
            });
        }
        if (!row.email?.trim()) {
            return res.status(400).json({ error: 'Candidate email is required to send the job description.' });
        }
        const requirement = await prisma.requirement.findUnique({
            where: { id: row.requirementId },
            select: {
                title: true,
                client: true,
                jobCode: true,
                jobDescription: true,
                description: true,
            },
        });
        if (!requirement) {
            return res.status(404).json({ error: 'Linked requirement not found.' });
        }
        const jobDescription = requirement.jobDescription?.trim() || requirement.description?.trim() || '';
        if (!jobDescription) {
            return res.status(400).json({
                error: 'This job has no description yet. Add a JD on the requirement first.',
            });
        }
        if (!isEmailConfigured()) {
            return res.status(503).json({ error: 'Email is not configured on this server.' });
        }
        const emailResult = await sendJobDescriptionEmail({
            to: row.email,
            candidateName: row.name,
            jobTitle: requirement.title,
            client: requirement.client,
            jobCode: requirement.jobCode,
            jobDescription,
        });
        if (!emailResult.sent) {
            const message = emailResult.reason === 'error' ? emailResult.message : 'Failed to send email';
            return res.status(500).json({ error: message });
        }
        await logActivity({
            entityType: 'CANDIDATE',
            entityId: row.id,
            action: 'JD_SENT',
            performedBy: req.auth.userId,
            details: {
                requirementId: row.requirementId,
                jobTitle: requirement.title,
                jobCode: requirement.jobCode,
                recipientEmail: row.email,
            },
        });
        res.json({ ok: true, emailSent: true });
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        console.error('Send JD failed:', err);
        res.status(500).json({ error: 'Failed to send job description' });
    }
});
router.delete('/:id', requireRoles('SUPER_ADMIN', 'ADMIN', 'HR_HEAD'), async (req, res) => {
    const row = await prisma.candidate.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Not found' });
    const interviews = await prisma.interview.findMany({
        where: { candidateId: row.id },
        select: { id: true },
    });
    const interviewIds = interviews.map((i) => i.id);
    await prisma.$transaction([
        prisma.feedback.deleteMany({
            where: {
                OR: [{ candidateId: row.id }, { interviewId: { in: interviewIds } }],
            },
        }),
        prisma.interview.deleteMany({ where: { candidateId: row.id } }),
        prisma.offer.deleteMany({ where: { candidateId: row.id } }),
        prisma.activityLog.deleteMany({
            where: { entityType: 'CANDIDATE', entityId: row.id },
        }),
    ]);
    await deleteResumeFile(row.id, row.resumeStorageKey);
    const portalUser = await prisma.user.findFirst({
        where: { email: row.email.toLowerCase(), role: 'CANDIDATE' },
    });
    if (portalUser) {
        await prisma.user.delete({ where: { id: portalUser.id } });
    }
    await prisma.candidate.delete({ where: { id: row.id } });
    if (row.requirementId)
        await syncRequirementHiringState(row.requirementId);
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: row.id,
        action: 'ERASED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { reason: 'dpdp_erasure' },
    });
    res.status(204).send();
});
export default router;
