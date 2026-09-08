import { isSuperAdminRole } from './orgAccess.js';
import { isJoinedStatus } from './candidateStatuses.js';
export const HIRED_STAGE_LOCK_MESSAGE = 'Only a Super Admin can change pipeline stage after a candidate has joined.';
export function assertCanChangeCandidateStatus(currentStatus, newStatus, role) {
    if (isJoinedStatus(currentStatus) &&
        newStatus !== currentStatus &&
        !isSuperAdminRole(role)) {
        throw new Error(HIRED_STAGE_LOCK_MESSAGE);
    }
}
