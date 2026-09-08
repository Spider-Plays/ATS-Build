import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { mapCandidate } from '../utils/mappers.js';
import { DUPLICATE_CANDIDATE_EMAIL_MESSAGE, DUPLICATE_CANDIDATE_PAN_MESSAGE, findCandidateByEmail, findCandidateByPan, isValidPanFormat, } from '../lib/candidateDuplicate.js';
import { requireAuth, requireActiveUser } from '../middleware/auth.js';
import { logActivity } from '../services/activityLog.js';
import { handleUploadResume } from '../middleware/uploadResume.js';
import { extractResumeText, parseResumeFields, buildCandidateResumePayload, } from '../lib/resumeParse.js';
import { getCatalogSkillNames } from '../lib/skillCatalog.js';
import { serializeSkills, parseSkillList, deserializeSkills } from '../lib/skills.js';
import { computeMatchScore } from '../lib/profileMatching.js';
import { isAllowedResumeFile, resolveResumeMime, saveResumeFile, } from '../lib/resumeStorage.js';
import { isReferralPortalRole } from '../lib/referralPortalRoles.js';
import { ensureUserReferralCode } from '../lib/referralCode.js';
import { notifyNewCandidate, notifyReferralSubmitted } from '../lib/emailDispatch.js';
import { buildCandidateSearchIndexFields } from '../lib/candidateFieldNormalize.js';
import { referralRequirementVisible } from '../lib/portalPositions.js';
import { isRequirementAcceptingCandidates, requirementApplicationsClosedMessage, } from '../lib/requirementHiring.js';
import { refreshRequirementHiringState, syncRequirementHiringState } from '../lib/hiring.js';
const router = Router();
function requireReferralPortalAccess(req, res, next) {
    if (!req.auth)
        return res.status(401).json({ error: 'Unauthorized' });
    if (!isReferralPortalRole(req.auth.role)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}
router.use(requireAuth, requireActiveUser, requireReferralPortalAccess);
const HIRED_STATUSES = new Set(['JOINED', 'HIRED']);
const ACTIVE_PIPELINE = new Set([
    'TO_BE_SCREENED',
    'SCREEN_SELECT',
    'L1_INTERVIEW',
    'MANAGERIAL_INTERVIEW',
    'CLIENT_INTERVIEW',
    'HR_INTERVIEW',
    'HR_INTERVIEW_SELECT',
    'TO_BE_OFFERED',
    'OFFERED',
    'OFFER_ACCEPTED',
    'BANK',
    'ON_HOLD',
]);
function mapReferralPosition(r) {
    return {
        id: r.id,
        jobCode: r.jobCode ?? r.id.slice(-8).toUpperCase(),
        client: r.client ?? undefined,
        title: r.title,
        department: r.department,
        location: r.location ?? r.locationCity ?? undefined,
        workMode: r.workMode ?? (r.isRemote ? 'Remote' : undefined),
        priority: r.priority ?? undefined,
        openings: r.openings,
        filled: r.filled,
        openingsRemaining: Math.max(0, r.openings - r.filled),
        description: r.jobDescription ?? r.description ?? undefined,
        salaryBand: r.salaryBand ?? undefined,
        experienceMinYears: r.experienceMinYears ?? undefined,
        experienceMaxYears: r.experienceMaxYears ?? undefined,
        referralBonusAmount: r.referralBonusAmount ?? undefined,
        primarySkills: JSON.parse(r.primarySkills || '[]'),
        updatedAt: r.updatedAt.toISOString(),
    };
}
function referralRequirementWhere() {
    return {
        status: 'LIVE',
        visibleToReferrals: true,
    };
}
async function assertReferralOwnsCandidate(userId, candidateId) {
    const row = await prisma.candidate.findFirst({
        where: { id: candidateId, referredByUserId: userId },
        select: { id: true },
    });
    if (!row)
        throw new Error('Referral not found');
}
const referralSubmitBodySchema = z.object({
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
    referralRelationship: z.string().min(1),
    referralNotes: z.string().max(500).optional(),
});
router.get('/me', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const referralCode = await ensureUserReferralCode(user.id);
    const referrerFilter = { referredByUserId: user.id };
    const [openJobRows, referrals, recentReferrals, byStatus] = await Promise.all([
        prisma.requirement.findMany({
            where: referralRequirementWhere(),
            select: {
                status: true,
                visibleToReferrals: true,
                filled: true,
                openings: true,
            },
        }),
        prisma.candidate.findMany({
            where: referrerFilter,
            orderBy: { createdAt: 'desc' },
        }),
        prisma.candidate.findMany({
            where: referrerFilter,
            orderBy: { createdAt: 'desc' },
            take: 6,
        }),
        prisma.candidate.groupBy({
            by: ['status'],
            where: referrerFilter,
            _count: { status: true },
        }),
    ]);
    const openJobs = openJobRows.filter(referralRequirementVisible).length;
    const hired = referrals.filter((c) => HIRED_STATUSES.has(c.status)).length;
    const inPipeline = referrals.filter((c) => ACTIVE_PIPELINE.has(c.status)).length;
    const REJECTED_STATUSES = new Set([
        'SCREEN_REJECT',
        'L1_INTERVIEW_REJECT',
        'MANAGERIAL_INTERVIEW_REJECT',
        'CLIENT_INTERVIEW_REJECT',
        'HR_INTERVIEW_REJECT',
        'POSITION_ABORT',
        'OFFER_DECLINED',
        'CANDIDATE_ABORT',
        'REJECTED',
    ]);
    const rejected = referrals.filter((c) => REJECTED_STATUSES.has(c.status)).length;
    const requirementIds = [
        ...new Set(referrals.map((c) => c.requirementId).filter(Boolean)),
    ];
    const requirements = requirementIds.length
        ? await prisma.requirement.findMany({
            where: { id: { in: requirementIds } },
            select: { id: true, title: true, jobCode: true, referralBonusAmount: true },
        })
        : [];
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    const potentialBonus = referrals
        .filter((c) => HIRED_STATUSES.has(c.status))
        .reduce((sum, c) => {
        const req = c.requirementId ? reqById.get(c.requirementId) : null;
        return sum + (req?.referralBonusAmount ?? 0);
    }, 0);
    res.json({
        user: {
            name: user.name,
            email: user.email,
            uid: user.id,
            department: user.department ?? undefined,
            role: user.role,
        },
        referralCode,
        stats: {
            openJobs,
            totalReferrals: referrals.length,
            inPipeline,
            hired,
            rejected,
            potentialBonus,
            statusBreakdown: byStatus.map((s) => ({
                status: s.status,
                count: s._count.status,
            })),
        },
        recentReferrals: recentReferrals.map((c) => {
            const req = c.requirementId ? reqById.get(c.requirementId) : null;
            return {
                id: c.id,
                name: c.name,
                email: c.email,
                status: c.status,
                jobTitle: c.jobTitle ?? req?.title,
                jobCode: req?.jobCode,
                referralRelationship: c.referralRelationship ?? undefined,
                createdAt: c.createdAt.toISOString(),
                bonusAmount: req?.referralBonusAmount ?? undefined,
            };
        }),
    });
});
router.get('/positions', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const department = typeof req.query.department === 'string' ? req.query.department.trim() : '';
    const rows = await prisma.requirement.findMany({
        where: {
            ...referralRequirementWhere(),
            ...(department ? { department } : {}),
        },
        orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
    });
    let mapped = rows.filter(referralRequirementVisible).map(mapReferralPosition);
    if (q) {
        mapped = mapped.filter((p) => p.title.toLowerCase().includes(q) ||
            p.department.toLowerCase().includes(q) ||
            (p.client?.toLowerCase().includes(q) ?? false) ||
            p.jobCode.toLowerCase().includes(q) ||
            p.primarySkills.some((s) => s.toLowerCase().includes(q)));
    }
    res.json(mapped);
});
router.get('/positions/departments', async (_req, res) => {
    const rows = await prisma.requirement.findMany({
        where: referralRequirementWhere(),
        orderBy: { updatedAt: 'desc' },
    });
    const departments = [
        ...new Set(rows.filter(referralRequirementVisible).map((r) => r.department)),
    ].sort();
    res.json(departments);
});
router.get('/positions/:id', async (req, res) => {
    const row = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!row || !referralRequirementVisible(row)) {
        return res.status(404).json({ error: 'Position not available for referrals' });
    }
    res.json(mapReferralPosition(row));
});
router.get('/referrals', async (req, res) => {
    const rows = await prisma.candidate.findMany({
        where: { referredByUserId: req.auth.userId },
        orderBy: { createdAt: 'desc' },
    });
    const requirementIds = [...new Set(rows.map((c) => c.requirementId).filter(Boolean))];
    const requirements = requirementIds.length
        ? await prisma.requirement.findMany({ where: { id: { in: requirementIds } } })
        : [];
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    res.json(rows.map((c) => ({
        ...mapCandidate(c, { requirement: c.requirementId ? reqById.get(c.requirementId) ?? null : null }),
        referralRelationship: c.referralRelationship ?? undefined,
        referralNotes: c.referralNotes ?? undefined,
        referralBonusAmount: c.requirementId
            ? reqById.get(c.requirementId)?.referralBonusAmount ?? undefined
            : undefined,
    })));
});
router.get('/referrals/:id', async (req, res) => {
    const row = await prisma.candidate.findFirst({
        where: { id: req.params.id, referredByUserId: req.auth.userId },
    });
    if (!row)
        return res.status(404).json({ error: 'Referral not found' });
    const requirement = row.requirementId
        ? await prisma.requirement.findUnique({ where: { id: row.requirementId } })
        : null;
    const logs = await prisma.activityLog.findMany({
        where: { entityType: 'CANDIDATE', entityId: row.id },
        orderBy: { timestamp: 'desc' },
        take: 20,
    });
    res.json({
        candidate: mapCandidate(row, { requirement }),
        referralRelationship: row.referralRelationship ?? undefined,
        referralNotes: row.referralNotes ?? undefined,
        referralBonusAmount: requirement?.referralBonusAmount ?? undefined,
        timeline: logs.map((l) => ({
            action: l.action,
            timestamp: l.timestamp.toISOString(),
            performerName: l.performerName ?? undefined,
            details: l.details ? JSON.parse(l.details) : undefined,
        })),
    });
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
        console.error('Referral resume parse failed:', err);
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
    if (!pan.trim() || !isValidPanFormat(pan)) {
        return res.json({ exists: false });
    }
    const existing = await findCandidateByPan(pan);
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
router.post('/positions/:id/submit', async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const referrerCode = await ensureUserReferralCode(user.id);
    let requirement = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!requirement) {
        return res.status(404).json({ error: 'Position not open for referrals' });
    }
    requirement = (await refreshRequirementHiringState(requirement.id)) ?? requirement;
    if (!referralRequirementVisible(requirement) || !isRequirementAcceptingCandidates(requirement)) {
        return res.status(400).json({
            error: requirementApplicationsClosedMessage(requirement),
        });
    }
    const body = referralSubmitBodySchema.parse(req.body);
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
    const deptLabel = user.department ? ` · ${user.department}` : '';
    const source = `Employee Referral: ${user.name}${deptLabel}`;
    const skillCorpus = [...primarySkills, ...secondarySkills].join(' ');
    const draft = {
        id: 'draft',
        name: fullName,
        email: body.email.toLowerCase().trim(),
        role: requirement.title,
        status: 'TO_BE_SCREENED',
        matchScore: 0,
        source,
        appliedDate: new Date(),
        requirementId: requirement.id,
        jobTitle: requirement.title,
        createdBy: user.id,
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
        vendorId: null,
        submittedByUserId: user.id,
        referredByUserId: user.id,
        referralRelationship: body.referralRelationship.trim(),
        referralNotes: body.referralNotes?.trim() || null,
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
            source,
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
            submittedByUserId: user.id,
            referredByUserId: user.id,
            referralRelationship: body.referralRelationship.trim(),
            referralNotes: body.referralNotes?.trim() || null,
            createdBy: user.id,
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
        action: 'REFERRAL_SUBMITTED',
        performedBy: user.id,
        performerName: user.name,
        performerRole: user.role,
        details: {
            requirementId: requirement.id,
            jobCode: requirement.jobCode,
            referralRelationship: body.referralRelationship,
            referrerCode,
        },
    });
    notifyReferralSubmitted({ name: row.name, email: row.email, jobTitle: row.jobTitle }, { email: user.email, name: user.name }, { title: requirement.title, jobCode: requirement.jobCode });
    notifyNewCandidate({
        id: row.id,
        name: row.name,
        email: row.email,
        jobTitle: row.jobTitle,
        requirementId: row.requirementId,
        source: row.source,
    }, { referrerName: user.name });
    await syncRequirementHiringState(requirement.id);
    res.status(201).json({
        ...mapCandidate(row, { requirement }),
        referralRelationship: row.referralRelationship ?? undefined,
        referralNotes: row.referralNotes ?? undefined,
    });
});
router.post('/referrals/:candidateId/resume', handleUploadResume, async (req, res) => {
    try {
        await assertReferralOwnsCandidate(req.auth.userId, req.params.candidateId);
    }
    catch {
        return res.status(404).json({ error: 'Referral not found' });
    }
    if (!req.file)
        return res.status(400).json({ error: 'Resume file is required' });
    if (!isAllowedResumeFile(req.file.mimetype, req.file.originalname)) {
        return res.status(400).json({ error: 'Only PDF, DOC, and DOCX files are allowed' });
    }
    const row = await prisma.candidate.findUnique({ where: { id: req.params.candidateId } });
    if (!row)
        return res.status(404).json({ error: 'Referral not found' });
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
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: row.id,
        action: 'RESUME_UPLOADED',
        performedBy: req.auth.userId,
        performerName: user?.name,
        performerRole: user?.role,
        details: { fileName: req.file.originalname, referralPortal: true },
    });
    res.json(mapCandidate(updated, { requirement }));
});
export default router;
