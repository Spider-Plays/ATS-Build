import { prisma } from './prisma.js';
import { maxHiringStage, } from './requirementHiring.js';
import { isJoinedStatus, TERMINAL_PIPELINE_STATUSES, } from './candidateStatuses.js';
const OFFERED_OFFER_STATUSES = new Set([
    'SENT',
    'APPROVED',
    'NEGOTIATION',
    'PENDING_HR_APPROVAL',
    'PENDING_EXEC_APPROVAL',
    'PENDING_APPROVAL',
]);
export async function deriveCandidateHiringStage(requirementId, candidateId, status) {
    if (TERMINAL_PIPELINE_STATUSES.has(status) && !isJoinedStatus(status)) {
        return null;
    }
    if (isJoinedStatus(status))
        return 'JOINED';
    if (status === 'OFFER_ACCEPTED')
        return 'OFFER_ACCEPTED';
    if (status === 'OFFERED')
        return 'OFFERED';
    if (status === 'TO_BE_OFFERED') {
        const offer = await prisma.offer.findFirst({
            where: { candidateId, requirementId },
            orderBy: { updatedAt: 'desc' },
            select: { status: true },
        });
        if (offer?.status === 'ACCEPTED')
            return 'OFFER_ACCEPTED';
        if (offer && OFFERED_OFFER_STATUSES.has(offer.status))
            return 'OFFERED';
        return 'TO_BE_OFFERED';
    }
    if (status === 'HR_INTERVIEW_SELECT')
        return 'HR_INTERVIEW';
    if (status === 'HR_INTERVIEW')
        return 'HR_INTERVIEW';
    if (status === 'CLIENT_INTERVIEW' || status === 'MANAGERIAL_INTERVIEW') {
        return 'L2_INTERVIEW';
    }
    if (status === 'L1_INTERVIEW')
        return 'L1_INTERVIEW';
    return 'SOURCING';
}
export async function computeRequirementHiringStageFromCandidates(requirementId) {
    const candidates = await prisma.candidate.findMany({
        where: {
            requirementId,
            status: {
                notIn: [
                    'REJECTED',
                    'SCREEN_REJECT',
                    'L1_INTERVIEW_REJECT',
                    'MANAGERIAL_INTERVIEW_REJECT',
                    'CLIENT_INTERVIEW_REJECT',
                    'HR_INTERVIEW_REJECT',
                    'POSITION_ABORT',
                    'OFFER_DECLINED',
                    'CANDIDATE_ABORT',
                ],
            },
        },
        select: { id: true, status: true },
    });
    if (candidates.length === 0)
        return 'SOURCING';
    const stages = [];
    for (const candidate of candidates) {
        const stage = await deriveCandidateHiringStage(requirementId, candidate.id, candidate.status);
        if (stage)
            stages.push(stage);
    }
    return maxHiringStage(stages);
}
