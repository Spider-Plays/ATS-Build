import { prisma } from './prisma.js';
import { logActivity } from '../services/activityLog.js';
import { notifyCandidateStatusChange } from './emailDispatch.js';
import { syncRequirementHiringState } from './hiring.js';
import { isJoinedStatus } from './candidateStatuses.js';
const HIRE_RECOMMENDATIONS = new Set(['STRONG_HIRE', 'HIRE']);
const REJECT_RECOMMENDATIONS = new Set(['NO_HIRE', 'STRONG_NO_HIRE']);
/** Happy-path interview stages in order (skips rejects / offer / parked). */
const INTERVIEW_FORWARD = [
    'L1_INTERVIEW',
    'MANAGERIAL_INTERVIEW',
    'CLIENT_INTERVIEW',
    'HR_INTERVIEW',
    'HR_INTERVIEW_SELECT',
];
const REJECT_BY_STAGE = {
    L1_INTERVIEW: 'L1_INTERVIEW_REJECT',
    MANAGERIAL_INTERVIEW: 'MANAGERIAL_INTERVIEW_REJECT',
    CLIENT_INTERVIEW: 'CLIENT_INTERVIEW_REJECT',
    HR_INTERVIEW: 'HR_INTERVIEW_REJECT',
    HR_INTERVIEW_SELECT: 'HR_INTERVIEW_REJECT',
};
/**
 * Map an interview plan stage (L1 / L2·Managerial / Client / HR) to the candidate
 * pipeline status for that round.
 */
export function pipelineStatusFromPlanStage(stage) {
    if (!stage)
        return null;
    const name = stage.name.trim().toLowerCase();
    if (/\bhr\b/.test(name) || name.includes('human resource'))
        return 'HR_INTERVIEW';
    if (name.includes('client'))
        return 'CLIENT_INTERVIEW';
    if (name.includes('managerial') ||
        name.includes('manager') ||
        /\bl2\b/.test(name) ||
        name.includes('level 2')) {
        return 'MANAGERIAL_INTERVIEW';
    }
    if (/\bl1\b/.test(name) || name.includes('level 1') || name.includes('screening interview')) {
        return 'L1_INTERVIEW';
    }
    // Default plan: order 0 = L1, 1 = L2/Managerial, 2 = HR
    if (stage.order <= 0)
        return 'L1_INTERVIEW';
    if (stage.order === 1)
        return 'MANAGERIAL_INTERVIEW';
    if (stage.order === 2)
        return 'HR_INTERVIEW';
    // Extra stages after HR — treat as still in HR until select.
    return 'HR_INTERVIEW';
}
function forwardIndex(status) {
    return INTERVIEW_FORWARD.indexOf(status);
}
function nextStatusAfterSelect(stageStatus) {
    const idx = forwardIndex(stageStatus);
    if (idx === -1)
        return null;
    return INTERVIEW_FORWARD[idx + 1] ?? null;
}
function resolveStageStatus(candidateStatus, planStageStatus) {
    // Prefer the plan-stage mapping (which interview was decided).
    if (planStageStatus)
        return planStageStatus;
    if (forwardIndex(candidateStatus) >= 0)
        return candidateStatus;
    if (candidateStatus === 'HR_INTERVIEW_SELECT')
        return 'HR_INTERVIEW_SELECT';
    return null;
}
/**
 * After interview feedback is submitted, move the candidate:
 * - Hire / Strong Hire → next pipeline stage (L1 select → Managerial, etc.)
 * - No Hire / Strong No Hire → stage reject status
 *
 * No-ops when the candidate is already at/past the target, joined, or recommendation
 * is On Hold.
 */
export async function advanceCandidateAfterInterviewFeedback(opts) {
    const { candidateId, interviewId, recommendation, performedBy, performerRole } = opts;
    const isHire = HIRE_RECOMMENDATIONS.has(recommendation);
    const isReject = REJECT_RECOMMENDATIONS.has(recommendation);
    if (!isHire && !isReject)
        return null;
    const [candidate, interview] = await Promise.all([
        prisma.candidate.findUnique({
            where: { id: candidateId },
            select: {
                id: true,
                status: true,
                email: true,
                name: true,
                jobTitle: true,
                requirementId: true,
                referredByUserId: true,
            },
        }),
        prisma.interview.findUnique({
            where: { id: interviewId },
            select: { id: true, planStageId: true, requirementId: true },
        }),
    ]);
    if (!candidate || !interview)
        return null;
    if (isJoinedStatus(candidate.status))
        return null;
    const planStage = interview.planStageId
        ? await prisma.interviewPlanStage.findUnique({
            where: { id: interview.planStageId },
            select: { order: true, name: true },
        })
        : null;
    const stageStatus = resolveStageStatus(candidate.status, pipelineStatusFromPlanStage(planStage));
    if (!stageStatus)
        return null;
    let nextStatus = null;
    if (isHire) {
        nextStatus = nextStatusAfterSelect(stageStatus);
        if (!nextStatus)
            return null;
        // Do not move backward or re-apply if already at/past the next stage.
        const currentIdx = forwardIndex(candidate.status);
        const nextIdx = forwardIndex(nextStatus);
        if (currentIdx !== -1 && nextIdx !== -1 && currentIdx >= nextIdx)
            return null;
        // If currently on a reject/parked side-path for an earlier stage, still allow hire advance.
    }
    else {
        nextStatus = REJECT_BY_STAGE[stageStatus] ?? null;
        if (!nextStatus)
            return null;
        if (candidate.status === nextStatus)
            return null;
    }
    const previousStatus = candidate.status;
    if (previousStatus === nextStatus)
        return null;
    const updated = await prisma.candidate.update({
        where: { id: candidate.id },
        data: { status: nextStatus, updatedAt: new Date() },
    });
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: updated.id,
        action: 'STATUS_CHANGED',
        performedBy,
        performerRole,
        details: {
            previousStatus,
            newStatus: nextStatus,
            reason: 'interview_feedback',
            recommendation,
            interviewId,
            stageName: planStage?.name,
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
    }, previousStatus);
    const requirementId = interview.requirementId ?? updated.requirementId;
    if (requirementId) {
        await syncRequirementHiringState(requirementId);
    }
    return { previousStatus, newStatus: nextStatus };
}
