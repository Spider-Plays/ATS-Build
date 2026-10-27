/** Role groups for route guards */
export const INTERNAL_ROLES = [
    'SUPER_ADMIN',
    'DEVELOPER',
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
    'HUMAN_RESOURCE',
    'FINANCE_HEAD',
    'RECRUITER',
    'TEAM_LEAD',
    'HIRING_MANAGER',
    'INTERVIEWER',
];
/** Staff roles that may call GET /api/requirements (includes read-only account managers). */
export const REQUIREMENT_API_ROLES = [...INTERNAL_ROLES, 'ACCOUNT_MANAGER'];
/**
 * Roles that may access the TA Report.
 * Recruiter: Client pivot = assigned jobs with full requirement metrics;
 * Recruiter pivot = own activity only. TEAM_LEAD (TA Lead) + HR + admins see org-wide.
 */
export const TA_REPORT_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
    'TEAM_LEAD',
    'RECRUITER',
];
/** Hiring / demand-fulfillment report (staff with Reports access; not Recruiters). */
export const HIRING_REPORT_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
    'TEAM_LEAD',
    'HIRING_MANAGER',
    'ACCOUNT_MANAGER',
    'FINANCE_HEAD',
    'INTERVIEWER',
];
/** Employee referral + vendor channel reports (HR leadership). */
export const CHANNEL_REPORT_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
];
export const STAFF_MUTATE = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
    'RECRUITER',
    'TEAM_LEAD',
];
/** HR Head and Super Admin approve directly; Admin with on-behalf-of-HR-Head flag. */
export const REQ_APPROVERS = ['HR_HEAD', 'SUPER_ADMIN', 'ADMIN'];
export const OFFER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_HEAD', 'TA_MANAGER', 'RECRUITER', 'TEAM_LEAD'];
/** Roles that may read offer data via GET /api/offers* */
export const OFFER_VIEW_ROLES = OFFER_ROLES;
export const OFFER_HR_APPROVERS = ['HR_HEAD', 'SUPER_ADMIN', 'ADMIN'];
export const OFFER_EXEC_APPROVERS = ['SUPER_ADMIN', 'ADMIN'];
/** Create, reschedule, and cancel interviews. Super Admin is not included; Developer bypasses requireExactRoles. */
export const INTERVIEW_SCHEDULERS = ['TA_MANAGER', 'RECRUITER'];
export const INTERVIEW_PLAN_EDITORS = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
    'TEAM_LEAD',
    'RECRUITER',
];
export function isAdminRole(role) {
    return role === 'ADMIN' || isSuperAdminRole(role);
}
export function isSuperAdminRole(role) {
    return role === 'SUPER_ADMIN' || role === 'DEVELOPER';
}
export function roleMatchesAllowed(userRole, allowedRoles) {
    if (userRole === 'SUPER_ADMIN' || userRole === 'DEVELOPER')
        return true;
    return allowedRoles.includes(userRole);
}
