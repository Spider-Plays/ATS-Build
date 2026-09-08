export const HIRING_STAGE_EDIT_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'RECRUITER',
    'HR_MANAGER',
    'TEAM_LEAD',
];
export const POSTING_CONTROL_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
    'TEAM_LEAD',
    'HIRING_MANAGER',
];
export const PORTAL_VISIBILITY_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
    'TEAM_LEAD',
];
export const REQUIREMENT_CREATE_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
    'HIRING_MANAGER',
];
/** Assign recruiters or vendors to a requirement (HR Manager leadership). */
export const REQUIREMENT_ASSIGNMENT_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
];
/** HR Head and Super Admin approve directly; Admin may approve only on behalf of HR Head. */
export const REQ_APPROVAL_ROLES = ['HR_HEAD', 'SUPER_ADMIN', 'ADMIN'];
export function isRequirementHiringManager(auth, requirement) {
    if (requirement.createdBy === auth.userId)
        return true;
    if (requirement.hiringManager === auth.userId)
        return true;
    if (!auth.name?.trim())
        return false;
    return (requirement.hiringManager.trim().toLowerCase() === auth.name.trim().toLowerCase());
}
export function assertCanManageRequirementPosting(auth, requirement) {
    if (['SUPER_ADMIN', 'ADMIN', 'HR_HEAD', 'HR_MANAGER', 'TEAM_LEAD'].includes(auth.role)) {
        return;
    }
    if (auth.role === 'HIRING_MANAGER') {
        if (!isRequirementHiringManager(auth, requirement)) {
            throw new Error('You can only manage requirements you created or hiring-manage');
        }
        return;
    }
    throw new Error('Not allowed to manage posting for this requirement');
}
export function assertCanUpdateHiringStage(auth, requirement) {
    if (!['LIVE', 'ON_HOLD'].includes(requirement.status)) {
        throw new Error('Hiring stage can only be updated for live or on-hold requirements');
    }
    if (!HIRING_STAGE_EDIT_ROLES.includes(auth.role)) {
        throw new Error('Only admins, recruiters, HR managers, and team leads can update hiring stage');
    }
}
export function assertCanApproveRequirement(auth, requirement, options = {}) {
    if (auth.role === 'SUPER_ADMIN') {
        return;
    }
    if (auth.role === 'HIRING_MANAGER') {
        throw new Error('Hiring managers cannot approve requirements');
    }
    if (requirement.createdBy && requirement.createdBy === auth.userId) {
        throw new Error('You cannot approve a requirement you submitted');
    }
    if (auth.role === 'HR_HEAD') {
        return;
    }
    if (auth.role === 'ADMIN') {
        if (!options.onBehalfOfHrHead) {
            throw new Error('Admin must select “on behalf of HR Head” to approve or reject');
        }
        return;
    }
    throw new Error('Only HR Head can approve or reject requirements');
}
