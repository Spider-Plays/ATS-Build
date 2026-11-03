import { hasTaOperation } from './userTags.js';
/** Full operational access (all data); Administration section remains admin-only. */
export const ORG_WIDE_ACCESS_ROLES = [
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
];
export function hasOrgWideAccess(role) {
    return role === 'DEVELOPER' || ORG_WIDE_ACCESS_ROLES.includes(role);
}
/** Org-wide roles for TA Report, plus TA Operation tag holders. */
export function hasTaReportOrgWideAccess(role, tags) {
    return hasOrgWideAccess(role) || hasTaOperation(role, tags);
}
export function isAdminRole(role) {
    return role === 'ADMIN' || role === 'DEVELOPER';
}
export function canManageUsers(role) {
    return isAdminRole(role);
}
