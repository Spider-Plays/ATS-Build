import { prisma } from './prisma.js';
export const CANDIDATE_PIPELINE_STATUSES = [
    'TO_BE_SCREENED',
    'SCREEN_SELECT',
    'SCREEN_REJECT',
    'L1_INTERVIEW',
    'L1_INTERVIEW_REJECT',
    'MANAGERIAL_INTERVIEW',
    'MANAGERIAL_INTERVIEW_REJECT',
    'CLIENT_INTERVIEW',
    'CLIENT_INTERVIEW_REJECT',
    'HR_INTERVIEW',
    'HR_INTERVIEW_SELECT',
    'HR_INTERVIEW_REJECT',
    'TO_BE_OFFERED',
    'OFFERED',
    'OFFER_ACCEPTED',
    'POSITION_ABORT',
    'OFFER_DECLINED',
    'CANDIDATE_ABORT',
    'JOINED',
    'BANK',
    'ON_HOLD',
];
/** Stages where interview scheduling is allowed. */
export const INTERVIEW_SCHEDULABLE_STATUSES = new Set([
    'L1_INTERVIEW',
    'MANAGERIAL_INTERVIEW',
    'CLIENT_INTERVIEW',
    'HR_INTERVIEW',
]);
/** Stages from which an offer may be created. */
export const OFFER_ELIGIBLE_STATUSES = new Set(['TO_BE_OFFERED', 'OFFERED']);
/** Terminal / outcome stages (not “in pipeline”). */
export const TERMINAL_PIPELINE_STATUSES = new Set([
    'SCREEN_REJECT',
    'L1_INTERVIEW_REJECT',
    'MANAGERIAL_INTERVIEW_REJECT',
    'CLIENT_INTERVIEW_REJECT',
    'HR_INTERVIEW_REJECT',
    'POSITION_ABORT',
    'OFFER_DECLINED',
    'CANDIDATE_ABORT',
    'JOINED',
]);
/** Parked side-states (also excluded from active pipeline). */
export const PARKED_PIPELINE_STATUSES = new Set(['BANK', 'ON_HOLD']);
const LEGACY_PRE_PIPELINE_STATUSES = new Set([
    'SOURCED',
    'APPLIED',
    'ADDED',
    'SUBMITTED',
    'SCREENING',
]);
const PRE_SUBMIT_LINK_STATUSES = new Set([...LEGACY_PRE_PIPELINE_STATUSES]);
export function isCandidatePipelineStatus(value) {
    return CANDIDATE_PIPELINE_STATUSES.includes(value);
}
export function isInterviewSchedulableStatus(status) {
    return INTERVIEW_SCHEDULABLE_STATUSES.has(status);
}
export function isOfferEligibleStatus(status) {
    return OFFER_ELIGIBLE_STATUSES.has(status);
}
export function isJoinedStatus(status) {
    return status === 'JOINED' || status === 'HIRED';
}
export function isTerminalOrParkedStatus(status) {
    return TERMINAL_PIPELINE_STATUSES.has(status) || PARKED_PIPELINE_STATUSES.has(status);
}
/** Default status when a candidate record is created. */
export function resolveCreateStatus(_requirementId) {
    return 'TO_BE_SCREENED';
}
/** When a candidate is linked to a requirement, ensure they are in the screening queue. */
export function buildRequirementTagUpdate(currentStatus, prevRequirementId, nextRequirementId) {
    if (prevRequirementId === nextRequirementId) {
        return {};
    }
    if (!nextRequirementId) {
        if (prevRequirementId && LEGACY_PRE_PIPELINE_STATUSES.has(currentStatus)) {
            return { status: 'TO_BE_SCREENED', submittedAt: null };
        }
        return {};
    }
    if (LEGACY_PRE_PIPELINE_STATUSES.has(currentStatus) ||
        currentStatus === 'TO_BE_SCREENED' ||
        !prevRequirementId) {
        return { status: 'TO_BE_SCREENED', submittedAt: new Date() };
    }
    return {};
}
/** Linked candidates should not remain in legacy pre-submit statuses. */
export async function repairLinkedCandidateStatuses(filter) {
    await prisma.candidate.updateMany({
        where: {
            requirementId: filter?.requirementId ?? { not: null },
            status: { in: [...PRE_SUBMIT_LINK_STATUSES] },
            ...(filter?.candidateIds?.length ? { id: { in: filter.candidateIds } } : {}),
        },
        data: {
            status: 'TO_BE_SCREENED',
            submittedAt: new Date(),
            updatedAt: new Date(),
        },
    });
}
export function autoScreeningDelayMs() {
    const hours = Number(process.env.CANDIDATE_AUTO_SCREENING_HOURS);
    if (Number.isFinite(hours) && hours > 0)
        return hours * 60 * 60 * 1000;
    return 24 * 60 * 60 * 1000;
}
/**
 * Legacy auto-promote SUBMITTED → SCREENING.
 * Both map to TO_BE_SCREENED now, so this is intentionally a no-op.
 */
export async function promoteSubmittedCandidatesToScreening() {
    return;
}
function fireAndForget(promise) {
    promise.catch((err) => console.error('[candidate-screening]', err instanceof Error ? err.message : err));
}
export function startCandidateScreeningJob() {
    const intervalMs = 15 * 60 * 1000;
    fireAndForget(promoteSubmittedCandidatesToScreening());
    setInterval(() => fireAndForget(promoteSubmittedCandidatesToScreening()), intervalMs);
}
