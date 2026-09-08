/** Roles that cannot use the employee referral portal API and UI */
export const REFERRAL_PORTAL_EXCLUDED_ROLES = ['CANDIDATE', 'VENDOR'];
export function isReferralPortalRole(role) {
    return !REFERRAL_PORTAL_EXCLUDED_ROLES.includes(role);
}
