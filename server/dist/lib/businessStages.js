/** Pre-SOW stages tracked on client cards. */
export const CLIENT_DEAL_STAGES = [
    { key: 'INITIAL_DISCUSSION', label: 'Initial Discussion', percentage: 10 },
    { key: 'PROPOSAL_SENT', label: 'Proposal Sent', percentage: 25 },
    { key: 'NEGOTIATION', label: 'Negotiation', percentage: 50 },
];
/** Role stages on requirements linked to a client card. */
export const LINKED_REQUIREMENT_STAGES = [
    { key: 'REQUIREMENT_CREATED', label: 'Requirement Created', percentage: 60 },
    { key: 'REQUIREMENT_CONFIRMED', label: 'Requirement Confirmed', percentage: 100 },
];
/** Post-SOW stages on standalone business requirements (no client card). */
export const REQUIREMENT_DEAL_STAGES = [
    { key: 'SOW', label: 'SOW', percentage: 60 },
    { key: 'SOW_SIGNED', label: 'SOW Signed', percentage: 75 },
    { key: 'CONFIRMED', label: 'Confirmed', percentage: 100 },
];
/** Full pipeline (legacy records without a client card). */
export const BUSINESS_STAGES = [
    ...CLIENT_DEAL_STAGES,
    ...REQUIREMENT_DEAL_STAGES,
];
export const CLIENT_DEAL_STAGE_KEYS = CLIENT_DEAL_STAGES.map((s) => s.key);
export const REQUIREMENT_DEAL_STAGE_KEYS = REQUIREMENT_DEAL_STAGES.map((s) => s.key);
export const LINKED_REQUIREMENT_STAGE_KEYS = LINKED_REQUIREMENT_STAGES.map((s) => s.key);
export const BUSINESS_STAGE_KEYS = BUSINESS_STAGES.map((s) => s.key);
export function isLinkedRequirementStageKey(value) {
    return LINKED_REQUIREMENT_STAGE_KEYS.includes(value);
}
export function linkedRequirementStagePercentage(stage) {
    const found = LINKED_REQUIREMENT_STAGES.find((s) => s.key === stage);
    return found?.percentage ?? 0;
}
export function isClientDealStageKey(value) {
    return CLIENT_DEAL_STAGE_KEYS.includes(value);
}
export function isRequirementDealStageKey(value) {
    return REQUIREMENT_DEAL_STAGE_KEYS.includes(value);
}
export function isBusinessStageKey(value) {
    return BUSINESS_STAGE_KEYS.includes(value);
}
export function businessStageLabel(stage) {
    const found = BUSINESS_STAGES.find((s) => s.key === stage) ??
        LINKED_REQUIREMENT_STAGES.find((s) => s.key === stage);
    return found?.label ?? stage.replace(/_/g, ' ');
}
export function businessStagePercentage(stage) {
    const found = BUSINESS_STAGES.find((s) => s.key === stage) ??
        LINKED_REQUIREMENT_STAGES.find((s) => s.key === stage);
    return found?.percentage ?? 0;
}
export const STAGE_ROLLBACK_ERROR = "Can't roll back to a previous stage";
export function isBusinessStageRollback(currentStage, nextStage) {
    return businessStagePercentage(nextStage) < businessStagePercentage(currentStage);
}
export function clientDealStagePercentage(stage) {
    const found = CLIENT_DEAL_STAGES.find((s) => s.key === stage);
    return found?.percentage ?? 0;
}
export function clientDealStageLabel(stage) {
    const found = CLIENT_DEAL_STAGES.find((s) => s.key === stage);
    return found?.label ?? stage.replace(/_/g, ' ');
}
