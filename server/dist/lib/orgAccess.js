/** Full operational access (all data); Administration section remains admin-only. */
export const ORG_WIDE_ACCESS_ROLES = [
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
];
export function hasOrgWideAccess(role) {
    return role === 'DEVELOPER' || ORG_WIDE_ACCESS_ROLES.includes(role);
}
/** Org-wide roles for TA Report, including Team Lead (TA Lead). */
export function hasTaReportOrgWideAccess(role) {
    return hasOrgWideAccess(role) || role === 'TEAM_LEAD';
}
export function isAdminRole(role) {
    return role === 'ADMIN' || role === 'DEVELOPER';
}
export function canManageUsers(role) {
    return isAdminRole(role);
}
