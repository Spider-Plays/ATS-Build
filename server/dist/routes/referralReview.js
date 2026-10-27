import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { mapCandidate } from '../utils/mappers.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { INTERNAL_ROLES } from '../lib/roles.js';
import { logActivity } from '../services/activityLog.js';
import { REFERRAL_BONUS_SERVICE_MONTHS, REFERRAL_BONUS_TIERS, REFERRAL_VALIDITY_MONTHS, ReferralWorkflowError, addMonths, canManageReferralBonus, canReviewReferrals, canViewReferralQueue, candidateExperienceYears, referralBonusBlockReason, referralBonusForExperience, referralValidUntil, notifyReferralCandidate, sendReferralMail, } from '../lib/referralWorkflow.js';
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
const userSelect = { id: true, name: true, email: true, department: true, referralCode: true };
/** Portal-submitted referrals plus legacy ERP rows that already joined (for the bonus view). */
const REFERRAL_ROW_WHERE = { referredByUserId: { not: null } };
async function decorate(rows) {
    const userIds = [
        ...new Set(rows.flatMap((r) => [r.referredByUserId, r.referralAssignedToUserId, r.createdBy]).filter(Boolean)),
    ];
    const reqIds = [...new Set(rows.map((r) => r.requirementId).filter(Boolean))];
    const [users, requirements] = await Promise.all([
        userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: userSelect }) : [],
        reqIds.length
            ? prisma.requirement.findMany({
                where: { id: { in: reqIds } },
                select: { id: true, jobCode: true, client: true, title: true },
            })
            : [],
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    const now = Date.now();
    return rows.map((c) => {
        const assignee = c.referralAssignedToUserId ? userById.get(c.referralAssignedToUserId) : undefined;
        const owner = c.referralStage === 'ACCEPTED' && c.createdBy ? userById.get(c.createdBy) : undefined;
        const validUntil = referralValidUntil(c);
        return {
            ...mapCandidate(c, {
                requirement: c.requirementId ? reqById.get(c.requirementId) ?? null : null,
                referrer: c.referredByUserId ? userById.get(c.referredByUserId) ?? null : null,
                recruiter: owner ?? null,
            }),
            referralAssignedToName: assignee?.name,
            referralValidUntil: validUntil.toISOString(),
            referralAgingDays: Math.floor((now - c.createdAt.getTime()) / 86_400_000),
            referralBonusTierAmount: referralBonusForExperience(candidateExperienceYears(c)) ?? undefined,
            referralBonusBlockedReason: referralBonusBlockReason(c) ?? undefined,
        };
    });
}
async function loadReferral(id) {
    const row = await prisma.candidate.findUnique({ where: { id } });
    if (!row || !row.referredByUserId)
        throw new ReferralWorkflowError('Referral not found', 404);
    return row;
}
function handle(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        }
        catch (err) {
            if (err instanceof ReferralWorkflowError)
                return res.status(err.status).json({ error: err.message });
            if (err instanceof z.ZodError) {
                return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid request' });
            }
            console.error('Referral review failed:', err);
            res.status(500).json({ error: 'Referral action failed' });
        }
    };
}
async function requireReviewer(auth) {
    if (!(await canReviewReferrals(auth))) {
        throw new ReferralWorkflowError('Only the employee referral team can do this', 403);
    }
}
async function actorName(userId) {
    return (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? '';
}
function assertNotExpired(row) {
    if (row.referralStage === 'EXPIRED') {
        throw new ReferralWorkflowError(`This referral lapsed after ${REFERRAL_VALIDITY_MONTHS} months and is now in the candidate pool`);
    }
}
/** Program rules for the UI. */
router.get('/program', (_req, res) => {
    res.json({
        validityMonths: REFERRAL_VALIDITY_MONTHS,
        serviceMonths: REFERRAL_BONUS_SERVICE_MONTHS,
        tiers: REFERRAL_BONUS_TIERS,
    });
});
/** Who can act on the queue and bonuses, for the current user. */
router.get('/access', handle(async (req, res) => {
    const auth = req.auth;
    res.json({
        canView: await canViewReferralQueue(auth),
        canReview: await canReviewReferrals(auth),
        canManageBonus: canManageReferralBonus(auth.role),
    });
}));
/** Recruiters the referral team can assign to. */
router.get('/recruiters', handle(async (req, res) => {
    await requireReviewer(req.auth);
    const users = await prisma.user.findMany({
        where: { status: 'ACTIVE', role: { in: ['RECRUITER', 'TEAM_LEAD'] } },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: 'asc' },
    });
    res.json(users);
}));
/** Employee Referral page queue: everything still in review plus accepted / lapsed history. */
router.get('/', handle(async (req, res) => {
    if (!(await canViewReferralQueue(req.auth))) {
        throw new ReferralWorkflowError('Forbidden', 403);
    }
    const rows = await prisma.candidate.findMany({
        where: { ...REFERRAL_ROW_WHERE, referralStage: { not: null } },
        orderBy: { createdAt: 'desc' },
    });
    res.json(await decorate(rows));
}));
/** Referrals waiting on the current recruiter (Approvals panel). */
router.get('/assigned', handle(async (req, res) => {
    const rows = await prisma.candidate.findMany({
        where: { referralStage: 'ASSIGNED', referralAssignedToUserId: req.auth.userId },
        orderBy: { referralAssignedAt: 'desc' },
    });
    res.json(await decorate(rows));
}));
/** Joined referrals and their bonus state. */
router.get('/bonuses', handle(async (req, res) => {
    const auth = req.auth;
    if (!canManageReferralBonus(auth.role) && !(await canViewReferralQueue(auth))) {
        throw new ReferralWorkflowError('Forbidden', 403);
    }
    const rows = await prisma.candidate.findMany({
        where: { ...REFERRAL_ROW_WHERE, status: { in: ['JOINED', 'HIRED'] } },
        orderBy: { joiningDate: 'desc' },
    });
    res.json(await decorate(rows));
}));
router.get('/:id', handle(async (req, res) => {
    const auth = req.auth;
    const row = await loadReferral(req.params.id);
    const isAssignee = row.referralStage === 'ASSIGNED' && row.referralAssignedToUserId === auth.userId;
    if (!isAssignee && !(await canViewReferralQueue(auth)) && !canManageReferralBonus(auth.role)) {
        throw new ReferralWorkflowError('Not allowed to view this referral', 403);
    }
    const logs = await prisma.activityLog.findMany({
        where: { entityType: 'CANDIDATE', entityId: row.id, action: { startsWith: 'REFERRAL_' } },
        orderBy: { timestamp: 'desc' },
        take: 30,
    });
    const [item] = await decorate([row]);
    res.json({
        candidate: item,
        timeline: logs.map((l) => ({
            id: l.id,
            action: l.action,
            timestamp: l.timestamp.toISOString(),
            performerName: l.performerName ?? undefined,
            details: l.details ? JSON.parse(l.details) : undefined,
        })),
    });
}));
const assignSchema = z.object({ recruiterId: z.string().min(1, 'Choose a recruiter') });
router.post('/:id/assign', handle(async (req, res) => {
    const auth = req.auth;
    await requireReviewer(auth);
    const { recruiterId } = assignSchema.parse(req.body);
    const row = await loadReferral(req.params.id);
    assertNotExpired(row);
    if (!['PENDING_REVIEW', 'ASSIGNED', 'BANKED'].includes(row.referralStage ?? '')) {
        throw new ReferralWorkflowError('Only referrals in review can be assigned');
    }
    const recruiter = await prisma.user.findFirst({
        where: { id: recruiterId, status: 'ACTIVE', role: { in: ['RECRUITER', 'TEAM_LEAD'] } },
        select: { id: true, name: true },
    });
    if (!recruiter)
        throw new ReferralWorkflowError('Recruiter not found or inactive');
    const updated = await prisma.candidate.update({
        where: { id: row.id },
        data: {
            referralStage: 'ASSIGNED',
            referralAssignedToUserId: recruiter.id,
            referralAssignedAt: new Date(),
            referralReviewedAt: new Date(),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: row.id,
        action: 'REFERRAL_ASSIGNED',
        performedBy: auth.userId,
        performerRole: auth.role,
        details: {
            candidateName: row.name,
            recruiterId: recruiter.id,
            recruiterName: recruiter.name,
            previousStage: row.referralStage,
        },
    });
    sendReferralMail('referralAssigned', updated, { actorName: await actorName(auth.userId) }, [recruiter.id]);
    // Shortlist mail only on the first assignment, not on reassignment after Bank.
    if (row.referralStage === 'PENDING_REVIEW')
        notifyReferralCandidate(updated, 'SCREEN_SELECT');
    res.json((await decorate([updated]))[0]);
}));
const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Enter a reason').max(1000) });
/** Referral team rejection: final, shown to the referrer. */
router.post('/:id/reject', handle(async (req, res) => {
    const auth = req.auth;
    await requireReviewer(auth);
    const { reason } = reasonSchema.parse(req.body);
    const row = await loadReferral(req.params.id);
    assertNotExpired(row);
    if (!['PENDING_REVIEW', 'ASSIGNED', 'BANKED'].includes(row.referralStage ?? '')) {
        throw new ReferralWorkflowError('Only referrals in review can be rejected');
    }
    const updated = await prisma.candidate.update({
        where: { id: row.id },
        data: {
            referralStage: 'REJECTED',
            referralRejectionReason: reason,
            referralAssignedToUserId: null,
            referralReviewedAt: new Date(),
            status: 'SCREEN_REJECT',
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: row.id,
        action: 'REFERRAL_REJECTED',
        performedBy: auth.userId,
        performerRole: auth.role,
        details: { candidateName: row.name, reason, previousStage: row.referralStage },
    });
    notifyReferralCandidate(updated, 'SCREEN_REJECT');
    sendReferralMail('referralRejected', updated, {
        rejectionReason: reason,
        actorName: await actorName(auth.userId),
    });
    res.json((await decorate([updated]))[0]);
}));
async function requireAssignee(auth, row) {
    if (row.referralStage !== 'ASSIGNED') {
        throw new ReferralWorkflowError('This referral is not waiting on a recruiter');
    }
    const isAdmin = ['SUPER_ADMIN', 'DEVELOPER'].includes(auth.role);
    if (row.referralAssignedToUserId !== auth.userId && !isAdmin) {
        throw new ReferralWorkflowError('Only the assigned recruiter can do this', 403);
    }
}
/** Recruiter accepts: the profile is theirs and joins the normal pipeline. */
router.post('/:id/accept', handle(async (req, res) => {
    const auth = req.auth;
    const row = await loadReferral(req.params.id);
    await requireAssignee(auth, row);
    const ownerId = row.referralAssignedToUserId ?? auth.userId;
    const updated = await prisma.candidate.update({
        where: { id: row.id },
        data: {
            referralStage: 'ACCEPTED',
            createdBy: ownerId,
            status: 'TO_BE_SCREENED',
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: row.id,
        action: 'REFERRAL_ACCEPTED',
        performedBy: auth.userId,
        performerRole: auth.role,
        details: { candidateName: row.name, recruiterId: ownerId },
    });
    res.json((await decorate([updated]))[0]);
}));
/** Recruiter rejects: profile goes to Bank and back to the referral team for reassignment. */
router.post('/:id/recruiter-reject', handle(async (req, res) => {
    const auth = req.auth;
    const { reason } = reasonSchema.parse(req.body);
    const row = await loadReferral(req.params.id);
    await requireAssignee(auth, row);
    const recruiterId = row.referralAssignedToUserId ?? auth.userId;
    const updated = await prisma.candidate.update({
        where: { id: row.id },
        data: {
            referralStage: 'BANKED',
            referralRejectionReason: reason,
            referralAssignedToUserId: null,
            status: 'BANK',
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: row.id,
        action: 'REFERRAL_RECRUITER_REJECTED',
        performedBy: auth.userId,
        performerRole: auth.role,
        details: { candidateName: row.name, reason, recruiterId },
    });
    sendReferralMail('referralRecruiterRejected', updated, { rejectionReason: reason }, [recruiterId]);
    res.json((await decorate([updated]))[0]);
}));
const bonusSchema = z.object({
    action: z.enum(['GRANT', 'CANCEL', 'PAID']),
    note: z.string().trim().max(1000).optional(),
});
/** TA Manager bonus decision on a joined referral. */
router.post('/:id/bonus', handle(async (req, res) => {
    const auth = req.auth;
    if (!canManageReferralBonus(auth.role)) {
        throw new ReferralWorkflowError('Only the TA Manager can change referral bonuses', 403);
    }
    const { action, note } = bonusSchema.parse(req.body);
    const row = await loadReferral(req.params.id);
    const now = new Date();
    let data;
    if (action === 'GRANT') {
        const blocked = referralBonusBlockReason(row);
        if (blocked)
            throw new ReferralWorkflowError(blocked);
        if (row.referralBonusStatus && row.referralBonusStatus !== 'PENDING') {
            throw new ReferralWorkflowError('A bonus decision was already made');
        }
        data = {
            referralBonusStatus: 'GRANTED',
            referralBonusAmount: referralBonusForExperience(candidateExperienceYears(row)),
            referralBonusEligibleOn: addMonths(row.joiningDate, REFERRAL_BONUS_SERVICE_MONTHS),
        };
    }
    else if (action === 'CANCEL') {
        if (row.referralBonusStatus === 'PAID')
            throw new ReferralWorkflowError('This bonus was already paid');
        if (row.referralBonusStatus === 'CANCELLED')
            throw new ReferralWorkflowError('Bonus is already cancelled');
        data = { referralBonusStatus: 'CANCELLED' };
    }
    else {
        if (row.referralBonusStatus !== 'GRANTED')
            throw new ReferralWorkflowError('Grant the bonus first');
        if (row.referralBonusEligibleOn && row.referralBonusEligibleOn > now) {
            throw new ReferralWorkflowError(`Payout is allowed after ${REFERRAL_BONUS_SERVICE_MONTHS} months of service`);
        }
        data = { referralBonusStatus: 'PAID' };
    }
    const updated = await prisma.candidate.update({
        where: { id: row.id },
        data: {
            ...data,
            referralBonusDecidedBy: auth.userId,
            referralBonusDecidedAt: now,
            referralBonusNote: note || null,
            updatedAt: now,
        },
    });
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: row.id,
        action: `REFERRAL_BONUS_${action === 'GRANT' ? 'GRANTED' : action === 'CANCEL' ? 'CANCELLED' : 'PAID'}`,
        performedBy: auth.userId,
        performerRole: auth.role,
        details: {
            candidateName: row.name,
            amount: updated.referralBonusAmount,
            eligibleOn: updated.referralBonusEligibleOn?.toISOString(),
            note,
        },
    });
    res.json((await decorate([updated]))[0]);
}));
export default router;
