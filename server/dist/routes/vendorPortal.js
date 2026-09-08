import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { mapVendor } from '../utils/mapVendor.js';
import { mapCandidate } from '../utils/mappers.js';
import { DUPLICATE_CANDIDATE_EMAIL_MESSAGE, DUPLICATE_CANDIDATE_PAN_MESSAGE, findCandidateByEmail, findCandidateByPan, isValidPanFormat, } from '../lib/candidateDuplicate.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { logActivity } from '../services/activityLog.js';
import { handleUploadResume } from '../middleware/uploadResume.js';
import { extractResumeText, parseResumeFields, buildCandidateResumePayload, } from '../lib/resumeParse.js';
import { getCatalogSkillNames } from '../lib/skillCatalog.js';
import { serializeSkills, parseSkillList, deserializeSkills } from '../lib/skills.js';
import { computeMatchScore } from '../lib/profileMatching.js';
import { isAllowedResumeFile, resolveResumeMime, saveResumeFile, } from '../lib/resumeStorage.js';
import { loadCandidateResume } from '../lib/candidateResume.js';
import { notifyNewCandidate } from '../lib/emailDispatch.js';
import { buildCandidateSearchIndexFields } from '../lib/candidateFieldNormalize.js';
import { mapPortalPosition, vendorRequirementVisible } from '../lib/portalPositions.js';
import { isRequirementAcceptingCandidates, requirementApplicationsClosedMessage, } from '../lib/requirementHiring.js';
import { refreshRequirementHiringState, syncRequirementHiringState } from '../lib/hiring.js';
import { getPortalOnboardingContext, mergeEvaluationPatch, mergeOnboardingPatch, notifyHrManagersSubmitted, computeScoring, parseOnboardingJson, parseEvaluationJson, validateOnboardingComplete, validateEvaluationComplete, } from './vendorOnboarding.js';
import { mapVendorOnboarding, mapVendorOnboardingStatus } from '../utils/mapVendorOnboarding.js';
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles('VENDOR'));
async function getVendorForUser(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.vendorId)
        return null;
    const vendor = await prisma.vendor.findUnique({ where: { id: user.vendorId } });
    if (!vendor || vendor.status !== 'ACTIVE')
        return null;
    return { user, vendor };
}
async function assignedRequirementIds(vendorId) {
    const rows = await prisma.vendorRequirement.findMany({
        where: { vendorId },
        select: { requirementId: true },
    });
    return rows.map((r) => r.requirementId);
}
async function assertVendorOwnsCandidate(vendorId, candidateId) {
    const row = await prisma.candidate.findFirst({
        where: { id: candidateId, vendorId },
        select: { id: true },
    });
    if (!row)
        throw new Error('Submission not found');
}
const vendorSubmitBodySchema = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    location: z.string().min(1),
    pan: z
        .string()
        .min(1)
        .refine((v) => /^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(v.trim()), 'Invalid PAN'),
    totalExperience: z.string().min(1),
    currentCompany: z.string().min(1),
    currentCTC: z.string().min(1),
    expectedCTC: z.string().min(1),
    noticePeriod: z.string().min(1),
    linkedIn: z.string().optional(),
    portfolio: z.string().optional(),
    primarySkills: z.array(z.string()).min(1),
    secondarySkills: z.array(z.string()).optional().default([]),
});
router.get('/me', async (req, res) => {
    const ctx = await getVendorForUser(req.auth.userId);
    if (!ctx) {
        return res.status(403).json({
            error: 'Your account is not linked to an active vendor organization',
        });
    }
    const { user, vendor } = ctx;
    const reqIds = await assignedRequirementIds(vendor.id);
    const [submissionCount, activeJobs, recentSubmissions, byStatus] = await Promise.all([
        prisma.candidate.count({ where: { vendorId: vendor.id } }),
        prisma.requirement.count({
            where: {
                id: { in: reqIds.length ? reqIds : ['__none__'] },
                status: 'LIVE',
            },
        }),
        prisma.candidate.findMany({
            where: { vendorId: vendor.id },
            orderBy: { createdAt: 'desc' },
            take: 5,
        }),
        prisma.candidate.groupBy({
            by: ['status'],
            where: { vendorId: vendor.id },
            _count: { status: true },
        }),
    ]);
    const requirements = reqIds.length
        ? await prisma.requirement.findMany({
            where: { id: { in: reqIds } },
            select: { id: true, title: true, jobCode: true },
        })
        : [];
    const onboardingRow = await prisma.vendorOnboarding.findUnique({ where: { vendorId: vendor.id } });
    const onboardingStatus = mapVendorOnboardingStatus(onboardingRow);
    res.json({
        user: { name: user.name, email: user.email, uid: user.id },
        vendor: mapVendor(vendor, {
            onboardingStatus: onboardingStatus?.status ?? null,
        }),
        onboardingStatus,
        stats: {
            assignedJobs: activeJobs,
            totalSubmissions: submissionCount,
            statusBreakdown: byStatus.map((s) => ({
                status: s.status,
                count: s._count.status,
            })),
        },
        recentSubmissions: recentSubmissions.map((c) => {
            const req = requirements.find((r) => r.id === c.requirementId);
            return {
                id: c.id,
                name: c.name,
                email: c.email,
                status: c.status,
                jobTitle: c.jobTitle ?? req?.title,
                jobCode: req?.jobCode,
                createdAt: c.createdAt.toISOString(),
            };
        }),
    });
});
router.get('/positions', async (req, res) => {
    const ctx = await getVendorForUser(req.auth.userId);
    if (!ctx)
        return res.status(403).json({ error: 'Vendor access not configured' });
    const reqIds = await assignedRequirementIds(ctx.vendor.id);
    if (reqIds.length === 0)
        return res.json([]);
    const rows = await prisma.requirement.findMany({
        where: {
            id: { in: reqIds },
            status: 'LIVE',
            visibleToVendors: true,
        },
        orderBy: { updatedAt: 'desc' },
    });
    res.json(rows.filter(vendorRequirementVisible).map(mapPortalPosition));
});
router.get('/positions/:id', async (req, res) => {
    const ctx = await getVendorForUser(req.auth.userId);
    if (!ctx)
        return res.status(403).json({ error: 'Vendor access not configured' });
    const reqIds = await assignedRequirementIds(ctx.vendor.id);
    if (!reqIds.includes(req.params.id)) {
        return res.status(404).json({ error: 'Position not assigned to your vendor' });
    }
    const row = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!row || !vendorRequirementVisible(row)) {
        return res.status(404).json({ error: 'Position not available' });
    }
    res.json(mapPortalPosition(row));
});
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
        console.error('Vendor resume parse failed:', err);
        const message = err instanceof Error ? err.message : 'Could not parse resume';
        res.status(422).json({ error: message });
    }
});
router.get('/check-email', async (req, res) => {
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    const excludeId = typeof req.query.excludeId === 'string' ? req.query.excludeId.trim() : '';
    if (!email.trim()) {
        return res.json({ exists: false });
    }
    const existing = await findCandidateByEmail(email, excludeId || undefined);
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
    const excludeId = typeof req.query.excludeId === 'string' ? req.query.excludeId.trim() : '';
    if (!pan.trim() || !isValidPanFormat(pan)) {
        return res.json({ exists: false });
    }
    const existing = await findCandidateByPan(pan, excludeId || undefined);
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
router.get('/submissions', async (req, res) => {
    const ctx = await getVendorForUser(req.auth.userId);
    if (!ctx)
        return res.status(403).json({ error: 'Vendor access not configured' });
    const rows = await prisma.candidate.findMany({
        where: { vendorId: ctx.vendor.id },
        orderBy: { createdAt: 'desc' },
    });
    const requirementIds = [...new Set(rows.map((c) => c.requirementId).filter(Boolean))];
    const requirements = requirementIds.length
        ? await prisma.requirement.findMany({ where: { id: { in: requirementIds } } })
        : [];
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    res.json(rows.map((c) => mapCandidate(c, { requirement: c.requirementId ? reqById.get(c.requirementId) ?? null : null })));
});
router.get('/submissions/:candidateId', async (req, res) => {
    const ctx = await getVendorForUser(req.auth.userId);
    if (!ctx)
        return res.status(403).json({ error: 'Vendor access not configured' });
    try {
        await assertVendorOwnsCandidate(ctx.vendor.id, req.params.candidateId);
    }
    catch {
        return res.status(404).json({ error: 'Submission not found' });
    }
    const row = await prisma.candidate.findUnique({ where: { id: req.params.candidateId } });
    if (!row)
        return res.status(404).json({ error: 'Submission not found' });
    const requirement = row.requirementId
        ? await prisma.requirement.findUnique({ where: { id: row.requirementId } })
        : null;
    res.json(mapCandidate(row, { requirement }));
});
router.patch('/submissions/:candidateId', async (req, res) => {
    const ctx = await getVendorForUser(req.auth.userId);
    if (!ctx)
        return res.status(403).json({ error: 'Vendor access not configured' });
    try {
        await assertVendorOwnsCandidate(ctx.vendor.id, req.params.candidateId);
    }
    catch {
        return res.status(404).json({ error: 'Submission not found' });
    }
    const existing = await prisma.candidate.findUnique({ where: { id: req.params.candidateId } });
    if (!existing)
        return res.status(404).json({ error: 'Submission not found' });
    const body = vendorSubmitBodySchema.parse(req.body);
    const fullName = `${body.firstName.trim()} ${body.lastName.trim()}`.trim();
    const primarySkills = parseSkillList(body.primarySkills);
    const secondarySkills = parseSkillList(body.secondarySkills ?? []);
    const duplicate = await findCandidateByEmail(body.email, req.params.candidateId);
    if (duplicate) {
        return res.status(409).json({
            error: DUPLICATE_CANDIDATE_EMAIL_MESSAGE,
            existingCandidateId: duplicate.id,
        });
    }
    const duplicatePan = await findCandidateByPan(body.pan, req.params.candidateId);
    if (duplicatePan) {
        return res.status(409).json({
            error: DUPLICATE_CANDIDATE_PAN_MESSAGE,
            existingCandidateId: duplicatePan.id,
        });
    }
    const requirement = existing.requirementId
        ? await prisma.requirement.findUnique({ where: { id: existing.requirementId } })
        : null;
    const skillCorpus = [...primarySkills, ...secondarySkills].join(' ');
    let matchScore = existing.matchScore;
    if (requirement) {
        const draft = {
            ...existing,
            name: fullName,
            email: body.email.toLowerCase().trim(),
            phone: body.phone.trim(),
            location: body.location.trim(),
            pan: body.pan.trim().toUpperCase(),
            totalExperience: body.totalExperience.trim(),
            currentCompany: body.currentCompany.trim(),
            currentCTC: body.currentCTC.trim(),
            expectedCTC: body.expectedCTC.trim(),
            noticePeriod: body.noticePeriod.trim(),
            linkedIn: body.linkedIn?.trim() || null,
            portfolio: body.portfolio?.trim() || null,
            primarySkills: serializeSkills(primarySkills),
            secondarySkills: serializeSkills(secondarySkills),
        };
        matchScore = computeMatchScore(draft, requirement, skillCorpus).score;
    }
    const updated = await prisma.candidate.update({
        where: { id: existing.id },
        data: {
            name: fullName,
            email: body.email.toLowerCase().trim(),
            phone: body.phone.trim(),
            location: body.location.trim(),
            pan: body.pan.trim().toUpperCase(),
            totalExperience: body.totalExperience.trim(),
            currentCompany: body.currentCompany.trim(),
            currentCTC: body.currentCTC.trim(),
            expectedCTC: body.expectedCTC.trim(),
            noticePeriod: body.noticePeriod.trim(),
            linkedIn: body.linkedIn?.trim() || null,
            portfolio: body.portfolio?.trim() || null,
            primarySkills: serializeSkills(primarySkills),
            secondarySkills: serializeSkills(secondarySkills),
            matchScore,
            ...buildCandidateSearchIndexFields({
                name: fullName,
                email: body.email.toLowerCase().trim(),
                role: existing.role,
                jobTitle: existing.jobTitle,
                location: body.location.trim(),
                currentCompany: body.currentCompany.trim(),
                primarySkills: serializeSkills(primarySkills),
                secondarySkills: serializeSkills(secondarySkills),
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
        entityId: updated.id,
        action: 'VENDOR_UPDATED_SUBMISSION',
        performedBy: ctx.user.id,
        performerName: ctx.user.name,
        performerRole: ctx.user.role,
        details: { vendorId: ctx.vendor.id, vendorName: ctx.vendor.name },
    });
    await logActivity({
        entityType: 'VENDOR',
        entityId: ctx.vendor.id,
        action: 'SUBMISSION_UPDATED',
        performedBy: ctx.user.id,
        performerName: ctx.user.name,
        performerRole: ctx.user.role,
        details: {
            candidateId: updated.id,
            candidateName: updated.name,
        },
    });
    res.json(mapCandidate(updated, { requirement }));
});
router.post('/positions/:id/submit', async (req, res) => {
    const ctx = await getVendorForUser(req.auth.userId);
    if (!ctx)
        return res.status(403).json({ error: 'Vendor access not configured' });
    const reqIds = await assignedRequirementIds(ctx.vendor.id);
    if (!reqIds.includes(req.params.id)) {
        return res.status(404).json({ error: 'Position not assigned to your vendor' });
    }
    let requirement = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!requirement) {
        return res.status(404).json({ error: 'Position not open for submissions' });
    }
    requirement = (await refreshRequirementHiringState(requirement.id)) ?? requirement;
    if (!vendorRequirementVisible(requirement) || !isRequirementAcceptingCandidates(requirement)) {
        return res.status(400).json({
            error: requirementApplicationsClosedMessage(requirement),
        });
    }
    const body = vendorSubmitBodySchema.parse(req.body);
    const fullName = `${body.firstName.trim()} ${body.lastName.trim()}`.trim();
    const primarySkills = parseSkillList(body.primarySkills);
    const secondarySkills = parseSkillList(body.secondarySkills ?? []);
    const duplicate = await findCandidateByEmail(body.email);
    if (duplicate) {
        return res.status(409).json({
            error: DUPLICATE_CANDIDATE_EMAIL_MESSAGE,
            existingCandidateId: duplicate.id,
        });
    }
    const duplicatePan = await findCandidateByPan(body.pan);
    if (duplicatePan) {
        return res.status(409).json({
            error: DUPLICATE_CANDIDATE_PAN_MESSAGE,
            existingCandidateId: duplicatePan.id,
        });
    }
    const skillCorpus = [...primarySkills, ...secondarySkills].join(' ');
    const draft = {
        id: 'draft',
        name: fullName,
        email: body.email.toLowerCase().trim(),
        role: requirement.title,
        status: 'TO_BE_SCREENED',
        matchScore: 0,
        source: `Vendor: ${ctx.vendor.name}`,
        appliedDate: new Date(),
        requirementId: requirement.id,
        jobTitle: requirement.title,
        createdBy: ctx.user.id,
        avatar: null,
        resumeUrl: null,
        resumeFileName: null,
        resumeMimeType: null,
        phone: body.phone.trim(),
        location: body.location.trim(),
        linkedIn: body.linkedIn?.trim() || null,
        portfolio: body.portfolio?.trim() || null,
        totalExperience: body.totalExperience.trim(),
        currentCompany: body.currentCompany.trim(),
        currentCTC: body.currentCTC.trim(),
        expectedCTC: body.expectedCTC.trim(),
        noticePeriod: body.noticePeriod.trim(),
        pan: body.pan.trim().toUpperCase(),
        vendorId: ctx.vendor.id,
        submittedByUserId: ctx.user.id,
        primarySkills: serializeSkills(primarySkills),
        secondarySkills: serializeSkills(secondarySkills),
        resumeText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    const matchScore = computeMatchScore(draft, requirement, skillCorpus).score;
    const row = await prisma.candidate.create({
        data: {
            name: fullName,
            email: body.email.toLowerCase().trim(),
            role: requirement.title,
            status: 'TO_BE_SCREENED',
            matchScore,
            source: `Vendor: ${ctx.vendor.name}`,
            requirementId: requirement.id,
            jobTitle: requirement.title,
            submittedAt: new Date(),
            phone: body.phone.trim(),
            location: body.location.trim(),
            pan: body.pan.trim().toUpperCase(),
            totalExperience: body.totalExperience.trim(),
            currentCompany: body.currentCompany.trim(),
            currentCTC: body.currentCTC.trim(),
            expectedCTC: body.expectedCTC.trim(),
            noticePeriod: body.noticePeriod.trim(),
            linkedIn: body.linkedIn?.trim() || null,
            portfolio: body.portfolio?.trim() || null,
            primarySkills: serializeSkills(primarySkills),
            secondarySkills: serializeSkills(secondarySkills),
            vendorId: ctx.vendor.id,
            submittedByUserId: ctx.user.id,
            createdBy: ctx.user.id,
            ...buildCandidateSearchIndexFields({
                name: fullName,
                email: body.email.toLowerCase().trim(),
                role: requirement.title,
                jobTitle: requirement.title,
                location: body.location.trim(),
                currentCompany: body.currentCompany.trim(),
                primarySkills: serializeSkills(primarySkills),
                secondarySkills: serializeSkills(secondarySkills),
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
        action: 'VENDOR_SUBMITTED',
        performedBy: ctx.user.id,
        performerName: ctx.user.name,
        performerRole: ctx.user.role,
        details: {
            vendorId: ctx.vendor.id,
            vendorName: ctx.vendor.name,
            requirementId: requirement.id,
            jobCode: requirement.jobCode,
        },
    });
    await logActivity({
        entityType: 'VENDOR',
        entityId: ctx.vendor.id,
        action: 'SUBMISSION_CREATED',
        performedBy: ctx.user.id,
        performerName: ctx.user.name,
        performerRole: ctx.user.role,
        details: {
            candidateId: row.id,
            candidateName: row.name,
            requirementId: requirement.id,
            jobTitle: requirement.title,
            jobCode: requirement.jobCode,
        },
    });
    notifyNewCandidate({
        id: row.id,
        name: row.name,
        email: row.email,
        jobTitle: row.jobTitle,
        requirementId: row.requirementId,
        source: row.source,
    }, { vendorName: ctx.vendor.name, submittedBy: ctx.user.name });
    await syncRequirementHiringState(requirement.id);
    res.status(201).json(mapCandidate(row, { requirement }));
});
router.post('/submissions/:candidateId/resume', handleUploadResume, async (req, res) => {
    const ctx = await getVendorForUser(req.auth.userId);
    if (!ctx)
        return res.status(403).json({ error: 'Vendor access not configured' });
    try {
        await assertVendorOwnsCandidate(ctx.vendor.id, req.params.candidateId);
    }
    catch {
        return res.status(404).json({ error: 'Submission not found' });
    }
    if (!req.file)
        return res.status(400).json({ error: 'Resume file is required' });
    if (!isAllowedResumeFile(req.file.mimetype, req.file.originalname)) {
        return res.status(400).json({ error: 'Only PDF, DOC, and DOCX files are allowed' });
    }
    const row = await prisma.candidate.findUnique({ where: { id: req.params.candidateId } });
    if (!row)
        return res.status(404).json({ error: 'Submission not found' });
    const mime = resolveResumeMime(req.file.mimetype, req.file.originalname);
    const stored = await saveResumeFile(row.id, mime, req.file.buffer, req.file.originalname, row.resumeStorageKey);
    let resumePayload = {
        resumeText: null,
        primarySkills: row.primarySkills,
        secondarySkills: row.secondarySkills,
    };
    try {
        const text = await extractResumeText(req.file.buffer, req.file.mimetype, req.file.originalname);
        const catalog = await getCatalogSkillNames();
        resumePayload = buildCandidateResumePayload(text, catalog);
    }
    catch {
        /* keep uploaded file without text extraction */
    }
    const requirement = row.requirementId
        ? await prisma.requirement.findUnique({ where: { id: row.requirementId } })
        : null;
    const existingPrimary = deserializeSkills(row.primarySkills);
    const existingSecondary = deserializeSkills(row.secondarySkills);
    const parsedPrimary = deserializeSkills(resumePayload.primarySkills);
    const parsedSecondary = deserializeSkills(resumePayload.secondarySkills);
    let updated = await prisma.candidate.update({
        where: { id: row.id },
        data: {
            resumeFileName: req.file.originalname,
            resumeMimeType: mime,
            resumeUrl: null,
            resumeStorageKey: null,
            resumeText: resumePayload.resumeText ?? row.resumeText,
            primarySkills: serializeSkills(existingPrimary.length ? existingPrimary : parsedPrimary),
            secondarySkills: serializeSkills(existingSecondary.length ? existingSecondary : parsedSecondary),
            ...buildCandidateSearchIndexFields({
                name: row.name,
                email: row.email,
                role: row.role,
                jobTitle: row.jobTitle,
                location: row.location,
                currentCompany: row.currentCompany,
                primarySkills: serializeSkills(existingPrimary.length ? existingPrimary : parsedPrimary),
                secondarySkills: serializeSkills(existingSecondary.length ? existingSecondary : parsedSecondary),
                resumeText: resumePayload.resumeText ?? row.resumeText,
                totalExperience: row.totalExperience,
                currentCTC: row.currentCTC,
                expectedCTC: row.expectedCTC,
                noticePeriod: row.noticePeriod,
            }),
            updatedAt: new Date(),
        },
    });
    if (requirement) {
        const corpus = [
            resumePayload.resumeText ?? '',
            ...parseSkillList(updated.primarySkills),
            ...parseSkillList(updated.secondarySkills),
        ]
            .filter(Boolean)
            .join('\n');
        if (corpus.trim()) {
            const { score } = computeMatchScore(updated, requirement, corpus);
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
        performedBy: ctx.user.id,
        performerName: ctx.user.name,
        performerRole: ctx.user.role,
        details: { fileName: req.file.originalname, vendorId: ctx.vendor.id },
    });
    res.json(mapCandidate(updated, { requirement }));
});
router.get('/submissions/:candidateId/resume', async (req, res) => {
    const ctx = await getVendorForUser(req.auth.userId);
    if (!ctx)
        return res.status(403).json({ error: 'Vendor access not configured' });
    try {
        await assertVendorOwnsCandidate(ctx.vendor.id, req.params.candidateId);
    }
    catch {
        return res.status(404).json({ error: 'Submission not found' });
    }
    const row = await prisma.candidate.findUnique({ where: { id: req.params.candidateId } });
    if (!row?.resumeFileName)
        return res.status(404).json({ error: 'No resume uploaded' });
    const loaded = await loadCandidateResume(row);
    if (!loaded)
        return res.status(404).json({ error: 'Resume file missing' });
    res.setHeader('Content-Type', loaded.mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(loaded.fileName)}"`);
    res.send(loaded.buffer);
});
// ─── Vendor onboarding / evaluation ──────────────────────────────────────────
router.get('/onboarding', async (req, res) => {
    try {
        const ctx = await getPortalOnboardingContext(req.auth.userId);
        if (!ctx) {
            return res.status(403).json({ error: 'Your account is not linked to an active vendor organization' });
        }
        if (!ctx.row) {
            return res.json({
                vendor: mapVendor(ctx.vendor, { onboardingStatus: null }),
                onboarding: null,
                status: null,
                grandfathered: true,
            });
        }
        const status = mapVendorOnboardingStatus(ctx.row);
        res.json({
            vendor: mapVendor(ctx.vendor, { onboardingStatus: status?.status ?? null }),
            onboarding: mapVendorOnboarding(ctx.row, { includeScoring: false }),
            status,
            grandfathered: false,
        });
    }
    catch (err) {
        console.error('GET /api/vendor-portal/onboarding failed:', err);
        res.status(500).json({ error: 'Failed to load onboarding' });
    }
});
router.patch('/onboarding', async (req, res) => {
    try {
        const ctx = await getPortalOnboardingContext(req.auth.userId);
        if (!ctx) {
            return res.status(403).json({ error: 'Your account is not linked to an active vendor organization' });
        }
        if (!ctx.row) {
            return res.status(400).json({ error: 'No onboarding packet required for this vendor' });
        }
        let row = ctx.row;
        if (row.status === 'SUBMITTED' || row.status === 'APPROVED') {
            return res.status(400).json({ error: 'Onboarding is locked while awaiting approval or after approval' });
        }
        const body = z
            .object({
            onboarding: z.record(z.unknown()).optional(),
            complete: z.boolean().optional(),
        })
            .parse(req.body);
        const current = parseOnboardingJson(row.onboardingJson);
        const merged = mergeOnboardingPatch(current, (body.onboarding ?? {}));
        if (body.complete) {
            const errMsg = validateOnboardingComplete(merged);
            if (errMsg)
                return res.status(400).json({ error: errMsg });
        }
        row = await prisma.vendorOnboarding.update({
            where: { id: row.id },
            data: {
                onboardingJson: JSON.stringify(merged),
                ...(body.complete
                    ? {
                        onboardingCompletedAt: new Date(),
                        status: 'EVALUATION',
                    }
                    : {
                        status: row.status === 'NOT_STARTED' || row.status === 'REJECTED' ? 'ONBOARDING' : row.status,
                    }),
            },
        });
        await logActivity({
            entityType: 'VENDOR',
            entityId: ctx.vendor.id,
            action: body.complete ? 'ONBOARDING_FORM_COMPLETED' : 'ONBOARDING_FORM_SAVED',
            performedBy: req.auth.userId,
            performerRole: 'VENDOR',
            details: { vendorName: ctx.vendor.name },
        });
        res.json({
            vendor: mapVendor(ctx.vendor, { onboardingStatus: mapVendorOnboardingStatus(row)?.status ?? null }),
            onboarding: mapVendorOnboarding(row, { includeScoring: false }),
            status: mapVendorOnboardingStatus(row),
        });
    }
    catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.errors[0]?.message ?? 'Invalid request' });
        }
        console.error('PATCH /api/vendor-portal/onboarding failed:', err);
        res.status(500).json({ error: 'Failed to save onboarding' });
    }
});
router.patch('/onboarding/evaluation', async (req, res) => {
    try {
        const ctx = await getPortalOnboardingContext(req.auth.userId);
        if (!ctx) {
            return res.status(403).json({ error: 'Your account is not linked to an active vendor organization' });
        }
        if (!ctx.row) {
            return res.status(400).json({ error: 'No onboarding packet required for this vendor' });
        }
        let row = ctx.row;
        if (row.status === 'SUBMITTED' || row.status === 'APPROVED') {
            return res.status(400).json({ error: 'Evaluation is locked while awaiting approval or after approval' });
        }
        if (row.status !== 'EVALUATION' &&
            row.status !== 'REJECTED' &&
            !row.onboardingCompletedAt) {
            return res.status(400).json({ error: 'Complete the onboarding form first' });
        }
        const body = z
            .object({
            evaluation: z.record(z.unknown()).optional(),
            complete: z.boolean().optional(),
        })
            .parse(req.body);
        const onboarding = parseOnboardingJson(row.onboardingJson);
        const current = parseEvaluationJson(row.evaluationJson);
        const merged = mergeEvaluationPatch(current, (body.evaluation ?? {}));
        if (body.complete) {
            const errMsg = validateEvaluationComplete(merged, onboarding.engagementTypes);
            if (errMsg)
                return res.status(400).json({ error: errMsg });
        }
        row = await prisma.vendorOnboarding.update({
            where: { id: row.id },
            data: {
                evaluationJson: JSON.stringify(merged),
                ...(body.complete
                    ? {
                        evaluationCompletedAt: new Date(),
                        status: 'EVALUATION',
                    }
                    : {
                        status: row.status === 'NOT_STARTED' || row.status === 'ONBOARDING'
                            ? 'EVALUATION'
                            : row.status === 'REJECTED'
                                ? 'EVALUATION'
                                : row.status,
                    }),
            },
        });
        await logActivity({
            entityType: 'VENDOR',
            entityId: ctx.vendor.id,
            action: body.complete ? 'EVALUATION_FORM_COMPLETED' : 'EVALUATION_FORM_SAVED',
            performedBy: req.auth.userId,
            performerRole: 'VENDOR',
            details: { vendorName: ctx.vendor.name },
        });
        res.json({
            vendor: mapVendor(ctx.vendor, { onboardingStatus: mapVendorOnboardingStatus(row)?.status ?? null }),
            onboarding: mapVendorOnboarding(row, { includeScoring: false }),
            status: mapVendorOnboardingStatus(row),
        });
    }
    catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.errors[0]?.message ?? 'Invalid request' });
        }
        console.error('PATCH /api/vendor-portal/onboarding/evaluation failed:', err);
        res.status(500).json({ error: 'Failed to save evaluation' });
    }
});
router.post('/onboarding/submit', async (req, res) => {
    try {
        const ctx = await getPortalOnboardingContext(req.auth.userId);
        if (!ctx) {
            return res.status(403).json({ error: 'Your account is not linked to an active vendor organization' });
        }
        if (!ctx.row) {
            return res.status(400).json({ error: 'No onboarding packet required for this vendor' });
        }
        let row = ctx.row;
        if (row.status === 'SUBMITTED') {
            return res.status(400).json({ error: 'Already submitted — waiting for HR approval' });
        }
        if (row.status === 'APPROVED') {
            return res.status(400).json({ error: 'Onboarding already approved' });
        }
        const onboarding = parseOnboardingJson(row.onboardingJson);
        const evaluation = parseEvaluationJson(row.evaluationJson);
        const onboardingErr = validateOnboardingComplete(onboarding);
        if (onboardingErr)
            return res.status(400).json({ error: onboardingErr });
        const evaluationErr = validateEvaluationComplete(evaluation, onboarding.engagementTypes);
        if (evaluationErr)
            return res.status(400).json({ error: evaluationErr });
        const scoring = computeScoring(evaluation, onboarding.engagementTypes);
        row = await prisma.vendorOnboarding.update({
            where: { id: row.id },
            data: {
                status: 'SUBMITTED',
                submittedAt: new Date(),
                submittedBy: req.auth.userId,
                onboardingCompletedAt: row.onboardingCompletedAt ?? new Date(),
                evaluationCompletedAt: row.evaluationCompletedAt ?? new Date(),
                scoringJson: JSON.stringify(scoring),
                overallPercentage: scoring.overallPercentage,
                category: scoring.category,
                decisionReason: null,
                decidedBy: null,
                decidedByName: null,
                decidedByRole: null,
                decidedAt: null,
            },
        });
        await logActivity({
            entityType: 'VENDOR',
            entityId: ctx.vendor.id,
            action: 'ONBOARDING_SUBMITTED',
            performedBy: req.auth.userId,
            performerRole: 'VENDOR',
            details: { vendorName: ctx.vendor.name },
        });
        void notifyHrManagersSubmitted(ctx.vendor.name, ctx.vendor.id);
        res.json({
            vendor: mapVendor(ctx.vendor, { onboardingStatus: mapVendorOnboardingStatus(row)?.status ?? null }),
            onboarding: mapVendorOnboarding(row, { includeScoring: false }),
            status: mapVendorOnboardingStatus(row),
        });
    }
    catch (err) {
        console.error('POST /api/vendor-portal/onboarding/submit failed:', err);
        res.status(500).json({ error: 'Failed to submit onboarding' });
    }
});
export default router;
