import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { DUPLICATE_CANDIDATE_EMAIL_MESSAGE, DUPLICATE_CANDIDATE_PAN_MESSAGE, findCandidateByEmail, findCandidateByPan, } from '../lib/candidateDuplicate.js';
import { getCandidateProfileMissing, isCandidateProfileComplete, PROFILE_FIELD_LABELS, } from '../lib/candidateProfileComplete.js';
import { computeMatchScore } from '../lib/profileMatching.js';
import { mapCandidate, mapInterview, mapOffer, mapRequirement } from '../utils/mappers.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { logActivity } from '../services/activityLog.js';
import { handleUploadResume } from '../middleware/uploadResume.js';
import { buildCandidateResumePayload, extractResumeText, parseResumeFields, } from '../lib/resumeParse.js';
import { getCatalogSkillNames } from '../lib/skillCatalog.js';
import { buildCandidateSearchIndexFields } from '../lib/candidateFieldNormalize.js';
import { isAllowedResumeFile, resolveResumeMime, saveResumeFile, } from '../lib/resumeStorage.js';
import { isRequirementListedOnPortal, portalJobClosedReason, resolvePortalJobStatus, } from '../lib/portalApplicationStatus.js';
import { assertCanRespondToOffer } from '../lib/offerPermissions.js';
import { appendOfferHistory, loadOfferLetterContext } from '../lib/offerActions.js';
import { notifyOfferStatusChange } from '../lib/emailDispatch.js';
import { renderHtmlToPdf } from '../lib/offerPdf.js';
import { mapPortalPosition, portalPositionsWhere, portalRequirementVisible, } from '../lib/portalPositions.js';
import { refreshRequirementHiringState, syncRequirementHiringState } from '../lib/hiring.js';
const PORTAL_UPDATE_ACTIONS = [
    'APPLIED',
    'STATUS_CHANGED',
    'INTERVIEW_SCHEDULED',
    'INTERVIEW_RESCHEDULED',
    'INTERVIEW_UPDATED',
    'INTERVIEW_CANCELLED',
];
const PORTAL_UPDATE_LABELS = {
    APPLIED: 'Application submitted',
    STATUS_CHANGED: 'Pipeline status updated',
    INTERVIEW_SCHEDULED: 'Interview scheduled',
    INTERVIEW_RESCHEDULED: 'Interview rescheduled',
    INTERVIEW_UPDATED: 'Interview updated',
    INTERVIEW_CANCELLED: 'Interview cancelled',
};
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles('CANDIDATE'));
const profileBodySchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    phone: z.string().min(1),
    location: z.string().min(1),
    totalExperience: z.string().min(1),
    currentCompany: z.string().min(1),
    currentCTC: z.string().min(1),
    expectedCTC: z.string().min(1),
    noticePeriod: z.string().min(1),
    pan: z
        .string()
        .min(1)
        .refine((v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(v.trim()), 'Invalid PAN'),
    linkedIn: z.string().url().optional().or(z.literal('')),
    portfolio: z.string().url().optional().or(z.literal('')),
});
function profileStatusPayload(candidate) {
    const missing = getCandidateProfileMissing(candidate);
    return {
        profileComplete: missing.length === 0,
        missingFields: missing.map((k) => PROFILE_FIELD_LABELS[k] ?? k),
    };
}
function parseActivityDetails(raw) {
    try {
        const parsed = JSON.parse(raw || '{}');
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
    }
    catch {
        return {};
    }
}
function mapPortalApplication(candidate, requirement, appliedAt, isCurrent) {
    const listedOnPortal = isRequirementListedOnPortal(requirement);
    const portalJobStatus = resolvePortalJobStatus(requirement, candidate.status);
    return {
        requirementId: requirement.id,
        jobCode: requirement.jobCode ?? requirement.id.slice(-8).toUpperCase(),
        title: requirement.title,
        department: requirement.department,
        client: requirement.client ?? undefined,
        location: requirement.location ?? undefined,
        description: requirement.description ?? undefined,
        requirementStatus: requirement.status,
        pipelineStatus: candidate.status,
        portalJobStatus,
        closedReason: portalJobClosedReason(requirement, candidate.status),
        matchScore: Math.round(candidate.matchScore),
        appliedAt: appliedAt.toISOString(),
        isCurrent,
        listedOnPortal,
    };
}
async function candidateAppliedToRequirement(candidateId, requirementId) {
    const logs = await prisma.activityLog.findMany({
        where: {
            entityType: 'CANDIDATE',
            entityId: candidateId,
            action: 'APPLIED',
        },
    });
    return logs.some((l) => {
        const d = parseActivityDetails(l.details);
        return d.requirementId === requirementId;
    });
}
function mapPortalUpdateEntry(log) {
    const details = parseActivityDetails(log.details);
    const label = PORTAL_UPDATE_LABELS[log.action] ?? log.action.replace(/_/g, ' ');
    let summary = label;
    if (log.action === 'STATUS_CHANGED' && typeof details.newStatus === 'string') {
        summary = `Status updated to ${details.newStatus}`;
    }
    if (log.action === 'APPLIED' && typeof details.title === 'string') {
        summary = `Applied for ${details.title}`;
    }
    if (log.action.startsWith('INTERVIEW_') && typeof details.stageName === 'string') {
        summary = `${label}: ${details.stageName}`;
    }
    return {
        id: log.id,
        action: log.action,
        title: label,
        summary,
        at: log.timestamp.toISOString(),
        performerName: log.performerName ?? undefined,
    };
}
router.post('/parse-resume', handleUploadResume, async (req, res) => {
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
        console.error('Portal resume parse failed:', err);
        const message = err instanceof Error ? err.message : 'Could not parse resume';
        res.status(422).json({ error: message });
    }
});
router.put('/profile', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const body = profileBodySchema.parse(req.body);
    const name = `${body.firstName.trim()} ${body.lastName.trim()}`.trim();
    const email = user.email.toLowerCase();
    const existing = await findCandidateByEmail(email);
    const normalizedPan = body.pan.trim().toUpperCase();
    const duplicatePan = await findCandidateByPan(normalizedPan, existing?.id);
    if (duplicatePan) {
        return res.status(409).json({
            error: DUPLICATE_CANDIDATE_PAN_MESSAGE,
            existingCandidateId: duplicatePan.id,
        });
    }
    let row;
    if (existing) {
        row = await prisma.candidate.update({
            where: { id: existing.id },
            data: {
                name,
                phone: body.phone.trim(),
                location: body.location.trim(),
                totalExperience: body.totalExperience.trim(),
                currentCompany: body.currentCompany.trim(),
                currentCTC: body.currentCTC.trim(),
                expectedCTC: body.expectedCTC.trim(),
                noticePeriod: body.noticePeriod.trim(),
                pan: normalizedPan,
                linkedIn: body.linkedIn?.trim() || null,
                portfolio: body.portfolio?.trim() || null,
                ...buildCandidateSearchIndexFields({
                    name,
                    email: existing.email,
                    role: existing.role,
                    jobTitle: existing.jobTitle,
                    location: body.location.trim(),
                    currentCompany: body.currentCompany.trim(),
                    primarySkills: existing.primarySkills,
                    secondarySkills: existing.secondarySkills,
                    resumeText: existing.resumeText,
                    totalExperience: body.totalExperience.trim(),
                    currentCTC: body.currentCTC.trim(),
                    expectedCTC: body.expectedCTC.trim(),
                    noticePeriod: body.noticePeriod.trim(),
                }),
                updatedAt: new Date(),
            },
        });
        await logActivity({
            entityType: 'CANDIDATE',
            entityId: row.id,
            action: 'UPDATED',
            performedBy: user.id,
            performerName: user.name,
            performerRole: user.role,
            details: { via: 'candidate_portal' },
        });
    }
    else {
        row = await prisma.candidate.create({
            data: {
                name,
                email,
                role: 'Candidate',
                status: 'TO_BE_SCREENED',
                matchScore: 0,
                source: 'Candidate Portal',
                phone: body.phone.trim(),
                location: body.location.trim(),
                totalExperience: body.totalExperience.trim(),
                currentCompany: body.currentCompany.trim(),
                currentCTC: body.currentCTC.trim(),
                expectedCTC: body.expectedCTC.trim(),
                noticePeriod: body.noticePeriod.trim(),
                pan: normalizedPan,
                linkedIn: body.linkedIn?.trim() || null,
                portfolio: body.portfolio?.trim() || null,
                primarySkills: '[]',
                secondarySkills: '[]',
                ...buildCandidateSearchIndexFields({
                    name,
                    email,
                    role: 'Candidate',
                    location: body.location.trim(),
                    currentCompany: body.currentCompany.trim(),
                    primarySkills: '[]',
                    secondarySkills: '[]',
                    totalExperience: body.totalExperience.trim(),
                    currentCTC: body.currentCTC.trim(),
                    expectedCTC: body.expectedCTC.trim(),
                    noticePeriod: body.noticePeriod.trim(),
                }),
            },
        });
        await logActivity({
            entityType: 'CANDIDATE',
            entityId: row.id,
            action: 'CREATED',
            performedBy: user.id,
            performerName: user.name,
            performerRole: user.role,
            details: { via: 'candidate_portal' },
        });
    }
    if (row.requirementId) {
        const requirement = await prisma.requirement.findUnique({
            where: { id: row.requirementId },
        });
        if (requirement) {
            const resumeText = row.resumeText ?? '';
            const { score } = computeMatchScore(row, requirement, resumeText);
            row = await prisma.candidate.update({
                where: { id: row.id },
                data: { matchScore: score },
            });
        }
    }
    await prisma.user.update({
        where: { id: user.id },
        data: { name, phoneNumber: body.phone.trim() },
    });
    const status = profileStatusPayload(row);
    res.json({
        candidate: mapCandidate(row),
        ...status,
    });
});
router.post('/profile/resume', handleUploadResume, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const candidate = await findCandidateByEmail(user.email);
    if (!candidate) {
        return res.status(400).json({
            error: 'Save your profile details before uploading a resume.',
        });
    }
    if (!req.file)
        return res.status(400).json({ error: 'Resume file is required' });
    if (!isAllowedResumeFile(req.file.mimetype, req.file.originalname)) {
        return res.status(400).json({ error: 'Only PDF, DOC, and DOCX files are allowed' });
    }
    const mime = resolveResumeMime(req.file.mimetype, req.file.originalname);
    const stored = await saveResumeFile(candidate.id, mime, req.file.buffer, req.file.originalname, candidate.resumeStorageKey);
    let resumePayload = {
        resumeText: null,
        primarySkills: candidate.primarySkills,
        secondarySkills: candidate.secondarySkills,
    };
    try {
        const catalog = await getCatalogSkillNames();
        const text = await extractResumeText(req.file.buffer, req.file.mimetype, req.file.originalname);
        const built = buildCandidateResumePayload(text, catalog);
        resumePayload = {
            resumeText: built.resumeText,
            primarySkills: built.primarySkills,
            secondarySkills: built.secondarySkills,
        };
    }
    catch {
        /* keep file without parsed text */
    }
    let updated = await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
            resumeFileName: req.file.originalname,
            resumeMimeType: mime,
            resumeUrl: null,
            resumeStorageKey: null,
            resumeText: resumePayload.resumeText,
            primarySkills: resumePayload.primarySkills,
            secondarySkills: resumePayload.secondarySkills,
            ...buildCandidateSearchIndexFields({
                name: candidate.name,
                email: candidate.email,
                role: candidate.role,
                jobTitle: candidate.jobTitle,
                location: candidate.location,
                currentCompany: candidate.currentCompany,
                primarySkills: resumePayload.primarySkills,
                secondarySkills: resumePayload.secondarySkills,
                resumeText: resumePayload.resumeText,
                totalExperience: candidate.totalExperience,
                currentCTC: candidate.currentCTC,
                expectedCTC: candidate.expectedCTC,
                noticePeriod: candidate.noticePeriod,
            }),
            updatedAt: new Date(),
        },
    });
    if (updated.requirementId) {
        const requirement = await prisma.requirement.findUnique({
            where: { id: updated.requirementId },
        });
        if (requirement && resumePayload.resumeText) {
            const { score } = computeMatchScore(updated, requirement, resumePayload.resumeText);
            updated = await prisma.candidate.update({
                where: { id: updated.id },
                data: { matchScore: score },
            });
        }
    }
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: updated.id,
        action: 'RESUME_UPLOADED',
        performedBy: user.id,
        performerName: user.name,
        performerRole: user.role,
        details: { fileName: req.file.originalname },
    });
    const status = profileStatusPayload(updated);
    res.json({
        candidate: mapCandidate(updated),
        ...status,
    });
});
router.get('/positions', async (_req, res) => {
    const rows = await prisma.requirement.findMany({
        where: portalPositionsWhere(),
        orderBy: { updatedAt: 'desc' },
    });
    res.json(rows.filter(portalRequirementVisible).map(mapPortalPosition));
});
router.get('/positions/:id', async (req, res) => {
    const row = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!row || !portalRequirementVisible(row)) {
        return res.status(404).json({ error: 'Position not found or not available' });
    }
    res.json(mapPortalPosition(row));
});
router.post('/positions/:id/apply', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    let requirement = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!requirement) {
        return res.status(404).json({ error: 'Position not found or not open for applications' });
    }
    requirement = (await refreshRequirementHiringState(requirement.id)) ?? requirement;
    if (!portalRequirementVisible(requirement)) {
        return res.status(404).json({ error: 'Position not found or not open for applications' });
    }
    const existing = await findCandidateByEmail(user.email);
    if (!existing) {
        return res.status(400).json({
            error: 'Complete your candidate profile before applying to a job.',
            code: 'PROFILE_INCOMPLETE',
        });
    }
    if (!isCandidateProfileComplete(existing)) {
        return res.status(400).json({
            error: 'Complete your candidate profile before applying to a job.',
            code: 'PROFILE_INCOMPLETE',
            missingFields: getCandidateProfileMissing(existing).map((k) => PROFILE_FIELD_LABELS[k] ?? k),
        });
    }
    if (existing.requirementId === requirement.id) {
        return res.json({
            alreadyApplied: true,
            candidate: mapCandidate(existing, { requirement }),
        });
    }
    if (existing.requirementId && existing.requirementId !== requirement.id) {
        return res.status(409).json({
            error: DUPLICATE_CANDIDATE_EMAIL_MESSAGE,
            existingCandidateId: existing.id,
        });
    }
    const resumeText = existing.resumeText ?? '';
    const { score } = computeMatchScore(existing, requirement, resumeText);
    const row = await prisma.candidate.update({
        where: { id: existing.id },
        data: {
            requirementId: requirement.id,
            jobTitle: requirement.title,
            role: requirement.title,
            status: 'TO_BE_SCREENED',
            matchScore: score,
            submittedAt: new Date(),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: row.id,
        action: 'APPLIED',
        performedBy: user.id,
        performerName: user.name,
        performerRole: user.role,
        details: {
            requirementId: requirement.id,
            jobCode: requirement.jobCode,
            title: requirement.title,
        },
    });
    await syncRequirementHiringState(requirement.id);
    res.status(201).json({
        alreadyApplied: false,
        candidate: mapCandidate(row, { requirement }),
    });
});
router.get('/applications', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const candidate = await findCandidateByEmail(user.email);
    if (!candidate) {
        return res.json({ applications: [] });
    }
    const applyLogs = await prisma.activityLog.findMany({
        where: {
            entityType: 'CANDIDATE',
            entityId: candidate.id,
            action: 'APPLIED',
        },
        orderBy: { timestamp: 'desc' },
    });
    const applications = [];
    const seenReqIds = new Set();
    if (candidate.requirementId) {
        const requirement = await prisma.requirement.findUnique({
            where: { id: candidate.requirementId },
        });
        if (requirement) {
            const logForReq = applyLogs.find((l) => {
                const d = parseActivityDetails(l.details);
                return d.requirementId === requirement.id;
            });
            applications.push(mapPortalApplication(candidate, requirement, logForReq?.timestamp ?? candidate.appliedDate, true));
            seenReqIds.add(requirement.id);
        }
    }
    for (const log of applyLogs) {
        const details = parseActivityDetails(log.details);
        const reqId = typeof details.requirementId === 'string' ? details.requirementId : '';
        if (!reqId || seenReqIds.has(reqId))
            continue;
        const requirement = await prisma.requirement.findUnique({ where: { id: reqId } });
        if (!requirement)
            continue;
        seenReqIds.add(reqId);
        applications.push(mapPortalApplication(candidate, requirement, log.timestamp, reqId === candidate.requirementId));
    }
    res.json({ applications });
});
router.get('/applications/:requirementId', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const candidate = await findCandidateByEmail(user.email);
    if (!candidate)
        return res.status(404).json({ error: 'Application not found' });
    const requirementId = req.params.requirementId;
    const hasApplied = await candidateAppliedToRequirement(candidate.id, requirementId);
    if (!hasApplied) {
        return res.status(404).json({ error: 'You have not applied to this position' });
    }
    const requirement = await prisma.requirement.findUnique({
        where: { id: requirementId },
    });
    if (!requirement)
        return res.status(404).json({ error: 'Position not found' });
    const applyLogs = await prisma.activityLog.findMany({
        where: {
            entityType: 'CANDIDATE',
            entityId: candidate.id,
            action: 'APPLIED',
        },
        orderBy: { timestamp: 'desc' },
    });
    const applyLog = applyLogs.find((l) => {
        const d = parseActivityDetails(l.details);
        return d.requirementId === requirementId;
    });
    const isCurrent = candidate.requirementId === requirementId;
    const application = mapPortalApplication(candidate, requirement, applyLog?.timestamp ?? candidate.appliedDate, isCurrent);
    const [interviewRows, offerRows, activityRows] = await Promise.all([
        prisma.interview.findMany({
            where: { candidateId: candidate.id, requirementId },
            orderBy: { scheduledAt: 'desc' },
        }),
        prisma.offer.findMany({
            where: { candidateId: candidate.id, requirementId },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.activityLog.findMany({
            where: {
                entityType: 'CANDIDATE',
                entityId: candidate.id,
                action: { in: [...PORTAL_UPDATE_ACTIONS] },
            },
            orderBy: { timestamp: 'desc' },
            take: 80,
        }),
    ]);
    const interviewIdsForReq = new Set(interviewRows.map((i) => i.id));
    const updates = activityRows
        .filter((log) => {
        const d = parseActivityDetails(log.details);
        if (log.action === 'APPLIED') {
            return d.requirementId === requirementId;
        }
        if (log.action === 'STATUS_CHANGED') {
            return isCurrent;
        }
        if (log.action.startsWith('INTERVIEW_')) {
            const interviewId = typeof d.interviewId === 'string' ? d.interviewId : '';
            return interviewIdsForReq.has(interviewId);
        }
        return false;
    })
        .map(mapPortalUpdateEntry);
    res.json({
        application,
        interviews: interviewRows.map(mapInterview),
        offers: offerRows.map(mapOffer),
        updates,
    });
});
router.get('/me', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const candidate = await prisma.candidate.findFirst({
        where: { email: { equals: user.email, mode: 'insensitive' } },
        orderBy: { updatedAt: 'desc' },
    });
    if (!candidate) {
        return res.json({
            linked: false,
            profileComplete: false,
            missingFields: Object.values(PROFILE_FIELD_LABELS),
            message: 'Complete your profile to apply for open positions.',
            user: { name: user.name, email: user.email },
        });
    }
    const profileStatus = profileStatusPayload(candidate);
    const [interviews, offers, linkedRequirement] = await Promise.all([
        prisma.interview.findMany({
            where: { candidateId: candidate.id },
            orderBy: { scheduledAt: 'desc' },
        }),
        prisma.offer.findMany({
            where: { candidateId: candidate.id },
            orderBy: { createdAt: 'desc' },
        }),
        candidate.requirementId
            ? prisma.requirement.findUnique({ where: { id: candidate.requirementId } })
            : null,
    ]);
    const requirementVisible = portalRequirementVisible(linkedRequirement);
    let requirementMessage;
    if (linkedRequirement && !requirementVisible) {
        if (linkedRequirement.status === 'ON_HOLD') {
            requirementMessage = 'This position is temporarily on hold.';
        }
        else if (!linkedRequirement.visibleToCandidates) {
            requirementMessage = 'Job details for your application are not shown on the portal.';
        }
        else {
            requirementMessage = 'This position is not currently listed on the candidate portal.';
        }
    }
    res.json({
        linked: true,
        ...profileStatus,
        candidate: mapCandidate(candidate, { requirement: linkedRequirement }),
        requirement: requirementVisible && linkedRequirement ? mapRequirement(linkedRequirement) : null,
        requirementHidden: !!linkedRequirement && !requirementVisible,
        requirementMessage,
        interviews: interviews.map(mapInterview),
        offers: offers.map(mapOffer).filter((o) => ['SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'].includes(o.status)),
        user: { name: user.name, email: user.email },
    });
});
async function assertPortalOfferAccess(userEmail, offerId) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer)
        return { error: 'Not found', status: 404 };
    const candidate = await prisma.candidate.findUnique({ where: { id: offer.candidateId } });
    if (!candidate || candidate.email.toLowerCase() !== userEmail.toLowerCase()) {
        return { error: 'Forbidden', status: 403 };
    }
    return { offer, candidate };
}
router.get('/offers/:id', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const access = await assertPortalOfferAccess(user.email, req.params.id);
    if ('error' in access && access.error) {
        return res.status(access.status).json({ error: access.error });
    }
    if (!('offer' in access))
        return res.status(500).json({ error: 'Unexpected error' });
    const { offer } = access;
    if (!['SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'].includes(offer.status)) {
        return res.status(403).json({ error: 'Offer not available' });
    }
    const ctx = await loadOfferLetterContext(offer.id);
    res.json({
        offer: mapOffer(offer),
        letterHtml: ctx?.letterHtml ?? offer.letterHtml,
    });
});
router.get('/offers/:id/letter/pdf', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    try {
        const access = await assertPortalOfferAccess(user.email, req.params.id);
        if ('error' in access && access.error) {
            return res.status(access.status).json({ error: access.error });
        }
        if (!('offer' in access))
            return res.status(500).json({ error: 'Unexpected error' });
        const { offer, candidate } = access;
        if (offer.status !== 'ACCEPTED') {
            return res.status(403).json({ error: 'Offer letter PDF is available after you accept the offer' });
        }
        const ctx = await loadOfferLetterContext(offer.id);
        if (!ctx?.letterHtml)
            return res.status(404).json({ error: 'Letter not found' });
        const pdf = await renderHtmlToPdf(ctx.letterHtml);
        const safeName = candidate.name.replace(/[^\w.-]+/g, '_').slice(0, 80);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="offer-${safeName}.pdf"`);
        res.send(pdf);
    }
    catch (err) {
        console.error('Portal offer letter PDF failed:', err);
        return res.status(500).json({ error: 'Failed to generate offer letter PDF' });
    }
});
router.post('/offers/:id/accept', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const access = await assertPortalOfferAccess(user.email, req.params.id);
    if ('error' in access && access.error) {
        return res.status(access.status).json({ error: access.error });
    }
    if (!('offer' in access))
        return res.status(500).json({ error: 'Unexpected error' });
    const { offer } = access;
    try {
        assertCanRespondToOffer(offer);
    }
    catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'Cannot accept' });
    }
    const row = await prisma.offer.update({
        where: { id: offer.id },
        data: {
            status: 'ACCEPTED',
            respondedAt: new Date(),
            respondedBy: 'CANDIDATE',
            history: appendOfferHistory(offer.history, 'ACCEPTED', 'Offer accepted by candidate via portal', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    notifyOfferStatusChange(row, 'ACCEPTED');
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'ACCEPTED',
        performedBy: req.auth.userId,
        performerRole: 'CANDIDATE',
        details: { via: 'portal' },
    });
    res.json(mapOffer(row));
});
router.post('/offers/:id/decline', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const access = await assertPortalOfferAccess(user.email, req.params.id);
    if ('error' in access && access.error) {
        return res.status(access.status).json({ error: access.error });
    }
    if (!('offer' in access))
        return res.status(500).json({ error: 'Unexpected error' });
    const { offer } = access;
    try {
        assertCanRespondToOffer(offer);
    }
    catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'Cannot decline' });
    }
    const row = await prisma.offer.update({
        where: { id: offer.id },
        data: {
            status: 'DECLINED',
            respondedAt: new Date(),
            respondedBy: 'CANDIDATE',
            history: appendOfferHistory(offer.history, 'DECLINED', 'Offer declined by candidate via portal', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    notifyOfferStatusChange(row, 'DECLINED');
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'DECLINED',
        performedBy: req.auth.userId,
        performerRole: 'CANDIDATE',
        details: { via: 'portal' },
    });
    res.json(mapOffer(row));
});
export default router;
