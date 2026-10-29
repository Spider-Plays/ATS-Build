import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { logActivity } from '../services/activityLog.js';
import { hasOrgWideAccess } from './orgAccess.js';
import { hasFeatureTag, parseFeatureTags } from './userTags.js';
import { isJoinedStatus } from './candidateStatuses.js';
import { parseExperienceYears } from './candidateFieldNormalize.js';
import { queueWorkflow, sendWorkflowMail } from './workflowMail.js';
import { sendCandidateStatusEmail } from '../services/email.js';
/**
 * Employee referral review gate.
 *
 * PENDING_REVIEW → (referral team) ASSIGNED | REJECTED
 * ASSIGNED       → (recruiter) ACCEPTED | BANKED; (referral team) reassign or reject
 * BANKED         → (referral team) ASSIGNED again | REJECTED
 * Gated profiles older than {@link REFERRAL_VALIDITY_MONTHS} become EXPIRED: they join the
 * normal candidate pool and the referrer can no longer claim a bonus.
 */
export const REFERRAL_STAGES = [
    'PENDING_REVIEW',
    'ASSIGNED',
    'REJECTED',
    'BANKED',
    'ACCEPTED',
    'EXPIRED',
];
/** Stages that keep a referral off the Candidates page, search, and pipelines. */
export const GATED_REFERRAL_STAGES = ['PENDING_REVIEW', 'ASSIGNED', 'REJECTED', 'BANKED'];
export const REFERRAL_VISIBLE_WHERE = {
    OR: [{ referralStage: null }, { referralStage: { notIn: GATED_REFERRAL_STAGES } }],
};
export const REFERRAL_VALIDITY_MONTHS = 3;
export const REFERRAL_BONUS_SERVICE_MONTHS = 6;
export const REFERRAL_BONUS_TIERS = [
    { label: '1 – 5 years', minYears: 1, maxYears: 5, amount: 25000 },
    { label: '5.1 – 8 years', minYears: 5, maxYears: 8, amount: 40000 },
    { label: '8+ years', minYears: 8, maxYears: null, amount: 70000 },
];
export const REFERRAL_BONUS_STATUSES = ['PENDING', 'GRANTED', 'PAID', 'CANCELLED'];
export class ReferralWorkflowError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
        this.name = 'ReferralWorkflowError';
    }
}
export function addMonths(date, months) {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
}
export function referralValidUntil(c) {
    return addMonths(c.createdAt, REFERRAL_VALIDITY_MONTHS);
}
export function isEmployeeReferralCandidate(c) {
    return Boolean(c.referredByUserId) || c.source.startsWith('Employee Referral');
}
export function candidateExperienceYears(c) {
    return c.experienceYears ?? parseExperienceYears(c.totalExperience);
}
/** Bonus tier from the candidate's total experience; null below 1 year. */
export function referralBonusForExperience(years) {
    if (years == null || years < 1)
        return null;
    if (years <= 5)
        return 25000;
    if (years <= 8)
        return 40000;
    return 70000;
}
async function userTags(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { permissions: true } });
    return parseFeatureTags(user?.permissions);
}
/** Assign / reject in the referral queue: Employee referral tag, TA Manager, admins. */
export async function canReviewReferrals(auth) {
    if (hasOrgWideAccess(auth.role))
        return true;
    return hasFeatureTag(auth.role, await userTags(auth.userId), 'employee_referral');
}
/** Read-only queue access also covers TA Operation. */
export async function canViewReferralQueue(auth) {
    if (await canReviewReferrals(auth))
        return true;
    return hasFeatureTag(auth.role, await userTags(auth.userId), 'ta_operation');
}
/** Grant / cancel / mark paid: TA Manager and admins. */
export function canManageReferralBonus(role) {
    return ['TA_MANAGER', 'ADMIN', 'DEVELOPER'].includes(role);
}
/** Why Grant bonus is unavailable, or null when it can be granted. */
export function referralBonusBlockReason(c) {
    if (!isEmployeeReferralCandidate(c))
        return 'Source is not Employee Referral.';
    if (!isJoinedStatus(c.status))
        return 'Candidate has not joined yet.';
    if (c.referralStage === 'EXPIRED') {
        return `Referral lapsed after ${REFERRAL_VALIDITY_MONTHS} months without being accepted.`;
    }
    if (!c.joiningDate)
        return 'Date of joining is missing.';
    if (referralBonusForExperience(candidateExperienceYears(c)) == null) {
        return 'Candidate has less than 1 year of experience.';
    }
    return null;
}
function formatDate(d) {
    return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
export function referralReviewUrl(candidateId) {
    return `${env.clientOrigin.replace(/\/$/, '')}/referral-review/${candidateId}`;
}
/**
 * Candidate-facing result of the referral team review: shortlisted when first assigned to a
 * recruiter, not selected when the referral team rejects. Uses the standard candidate status email.
 */
export function notifyReferralCandidate(candidate, status) {
    if (!candidate.email)
        return;
    queueWorkflow((async () => {
        const requirement = candidate.requirementId
            ? await prisma.requirement.findUnique({ where: { id: candidate.requirementId }, select: { title: true } })
            : null;
        return sendCandidateStatusEmail({
            to: candidate.email,
            candidateName: candidate.name,
            status,
            jobTitle: requirement?.title ?? candidate.jobTitle ?? 'opportunities at IGS',
        });
    })());
}
/** Send one referral workflow mail (fire-and-forget). */
export function sendReferralMail(key, candidate, extra = {}, recruiterIds = []) {
    queueWorkflow((async () => {
        const [referrer, requirement, recruiters] = await Promise.all([
            candidate.referredByUserId
                ? prisma.user.findUnique({ where: { id: candidate.referredByUserId }, select: { name: true } })
                : null,
            candidate.requirementId
                ? prisma.requirement.findUnique({
                    where: { id: candidate.requirementId },
                    select: { title: true, jobCode: true },
                })
                : null,
            recruiterIds.length
                ? prisma.user.findMany({ where: { id: { in: recruiterIds } }, select: { name: true } })
                : [],
        ]);
        return sendWorkflowMail({
            key,
            context: {
                requirementId: candidate.requirementId,
                recruiterIds,
                referrerId: candidate.referredByUserId,
                values: {
                    candidateName: candidate.name,
                    candidateEmail: candidate.email,
                    candidatePhone: candidate.phone ?? '',
                    totalExperience: candidate.totalExperience ?? '',
                    currentCompany: candidate.currentCompany ?? '',
                    jobTitle: requirement?.title ?? candidate.jobTitle ?? 'General referral (no job)',
                    reqId: requirement?.jobCode ?? '',
                    referrerName: referrer?.name ?? '',
                    referralRelationship: candidate.referralRelationship ?? '',
                    recruiterName: recruiters.map((r) => r.name).join(', '),
                    joiningDate: formatDate(candidate.joiningDate),
                    portalUrl: referralReviewUrl(candidate.id),
                    ...extra,
                },
            },
        });
    })());
}
/** Called after a status change to JOINED: opens the bonus decision and mails the referrer. */
export async function onReferralJoined(candidateId) {
    const row = await prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!row || !row.referredByUserId || !isJoinedStatus(row.status))
        return;
    const updated = row.referralBonusStatus
        ? row
        : await prisma.candidate.update({
            where: { id: row.id },
            data: { referralBonusStatus: 'PENDING' },
        });
    const recruiterIds = updated.createdBy && updated.createdBy !== updated.referredByUserId ? [updated.createdBy] : [];
    sendReferralMail('referralJoined', updated, {}, recruiterIds);
}
/** Gated referrals past the validity window move to the general candidate pool. */
export async function expireStaleReferrals(now = new Date()) {
    const cutoff = addMonths(now, -REFERRAL_VALIDITY_MONTHS);
    const stale = await prisma.candidate.findMany({
        where: { referralStage: { in: GATED_REFERRAL_STAGES }, createdAt: { lt: cutoff } },
        select: { id: true, referralStage: true },
    });
    for (const c of stale) {
        await prisma.candidate.update({
            where: { id: c.id },
            data: { referralStage: 'EXPIRED', referralAssignedToUserId: null, updatedAt: now },
        });
        await logActivity({
            entityType: 'CANDIDATE',
            entityId: c.id,
            action: 'REFERRAL_EXPIRED',
            performedBy: 'system',
            performerName: 'System',
            details: { previousStage: c.referralStage, validityMonths: REFERRAL_VALIDITY_MONTHS },
        });
    }
    return stale.length;
}
export function startReferralExpiryJob() {
    const run = () => expireStaleReferrals().catch((err) => console.error('[referral-expiry]', err instanceof Error ? err.message : err));
    void run();
    setInterval(run, 60 * 60 * 1000);
}
