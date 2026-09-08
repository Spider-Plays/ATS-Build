import { isRequirementFull } from './requirementHiring.js';
import { portalRequirementVisible } from './portalPositions.js';
const CLOSED_REQUIREMENT_STATUSES = new Set(['CLOSED', 'ON_HOLD', 'CANCELLED']);
/** LIVE requirements posted to the candidate portal also appear on the public careers page. */
export function isRequirementListedOnPortal(requirement) {
    return portalRequirementVisible(requirement);
}
export function resolvePortalJobStatus(requirement, pipelineStatus) {
    if (pipelineStatus === 'JOINED' || pipelineStatus === 'HIRED')
        return 'CLOSED';
    if (!isRequirementListedOnPortal(requirement))
        return 'CLOSED';
    if (CLOSED_REQUIREMENT_STATUSES.has(requirement.status))
        return 'CLOSED';
    if (isRequirementFull(requirement.filled ?? 0, requirement.openings ?? 0))
        return 'CLOSED';
    return 'ACTIVE';
}
export function portalJobClosedReason(requirement, pipelineStatus) {
    if (resolvePortalJobStatus(requirement, pipelineStatus) === 'ACTIVE') {
        return undefined;
    }
    if (pipelineStatus === 'JOINED' || pipelineStatus === 'HIRED') {
        return 'You have joined — this application is closed on the portal.';
    }
    if (isRequirementFull(requirement.filled ?? 0, requirement.openings ?? 0)) {
        return 'All positions for this role are filled.';
    }
    if (requirement.status === 'ON_HOLD') {
        return 'This position is on hold and is closed for updates on the portal.';
    }
    if (requirement.status === 'CANCELLED') {
        return 'This position was cancelled and is closed on the portal.';
    }
    if (requirement.status === 'CLOSED') {
        return 'This position is closed.';
    }
    if (!requirement.visibleToCandidates) {
        return 'This role is no longer visible on the candidate portal.';
    }
    return 'This application is closed on the portal.';
}
