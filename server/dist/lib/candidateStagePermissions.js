import { isAdminRole } from './orgAccess.js';
import { isJoinedStatus } from './candidateStatuses.js';
export const HIRED_STAGE_LOCK_MESSAGE = 'Only a Admin can change pipeline stage after a candidate has joined.';
export function assertCanChangeCandidateStatus(currentStatus, newStatus, role) {
    if (isJoinedStatus(currentStatus) &&
        newStatus !== currentStatus &&
        !isAdminRole(role)) {
        throw new Error(HIRED_STAGE_LOCK_MESSAGE);
    }
}
