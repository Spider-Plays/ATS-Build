export const HIRING_STAGES = [
    'SOURCING',
    'L1_INTERVIEW',
    'L2_INTERVIEW',
    'HR_INTERVIEW',
    'TO_BE_OFFERED',
    'OFFERED',
    'OFFER_ACCEPTED',
    'JOINED',
];
export function isHiringStage(value) {
    return HIRING_STAGES.includes(value);
}
export const TERMINAL_POSTING_STATUSES = ['CLOSED', 'CANCELLED', 'REJECTED'];
export function canEditHiringStage(postingStatus) {
    return ['LIVE', 'ON_HOLD'].includes(postingStatus);
}
const STAGE_RANK = {
    SOURCING: 0,
    L1_INTERVIEW: 1,
    L2_INTERVIEW: 2,
    HR_INTERVIEW: 3,
    TO_BE_OFFERED: 4,
    OFFERED: 5,
    OFFER_ACCEPTED: 6,
    JOINED: 7,
};
export function hiringStageRank(stage) {
    return STAGE_RANK[stage] ?? 0;
}
export function maxHiringStage(stages) {
    if (stages.length === 0)
        return 'SOURCING';
    return stages.reduce((best, stage) => hiringStageRank(stage) > hiringStageRank(best) ? stage : best);
}
export function isRequirementFull(filled, openings) {
    return openings > 0 && filled >= openings;
}
export function isRequirementAcceptingCandidates(input) {
    if (input.status === 'CANCELLED')
        return false;
    return !isRequirementFull(input.filled, input.openings);
}
export function requirementApplicationsClosedMessage(input) {
    if (input.status === 'CANCELLED') {
        return 'This requirement is cancelled and cannot accept new applications.';
    }
    if (isRequirementFull(input.filled, input.openings)) {
        return 'All positions for this requirement are filled.';
    }
    if (input.status === 'CLOSED') {
        return 'This requirement is closed and cannot accept new applications.';
    }
    return 'This requirement is not accepting applications.';
}
