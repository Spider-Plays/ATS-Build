/** Full operational access (all data); Administration section remains admin-only. */
export const ORG_WIDE_ACCESS_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
];
export function hasOrgWideAccess(role) {
    return ORG_WIDE_ACCESS_ROLES.includes(role);
}
/** Org-wide roles for TA Report, including Team Lead (TA Lead). */
export function hasTaReportOrgWideAccess(role) {
    return hasOrgWideAccess(role) || role === 'TEAM_LEAD';
}
export function isAdminRole(role) {
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
}
export function isSuperAdminRole(role) {
    return role === 'SUPER_ADMIN';
}
export function canManageUsers(role) {
    return isSuperAdminRole(role);
}
