import { prisma } from './prisma.js';
export async function getUserEmailsByIds(userIds) {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0)
        return [];
    const users = await prisma.user.findMany({
        where: { id: { in: unique }, status: 'ACTIVE' },
        select: { id: true, email: true, name: true },
    });
    return users;
}
export async function getRequirementRecruiterEmails(requirementId) {
    if (!requirementId)
        return [];
    const requirement = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: { recruiters: true, createdBy: true, hiringManager: true },
    });
    if (!requirement)
        return [];
    const recruiterIds = JSON.parse(requirement.recruiters || '[]');
    const ids = [...new Set([...recruiterIds, requirement.createdBy, requirement.hiringManager].filter(Boolean))];
    const users = await getUserEmailsByIds(ids);
    return users.map((u) => ({ email: u.email, name: u.name }));
}
/** Resolve hiring manager stored as user id or display name. */
async function resolveHiringManagerRecipients(hiringManager) {
    const ref = (hiringManager ?? '').trim();
    if (!ref)
        return [];
    const byId = await getUserEmailsByIds([ref]);
    if (byId.length > 0)
        return byId.map((u) => ({ email: u.email, name: u.name }));
    const byName = await prisma.user.findMany({
        where: {
            status: 'ACTIVE',
            role: 'HIRING_MANAGER',
            name: { equals: ref, mode: 'insensitive' },
        },
        select: { email: true, name: true },
    });
    return byName;
}
/**
 * HR Managers (role), assigned recruiters, and the named hiring manager
 * for requirement SLA ageing alerts (20 / 40 days).
 */
export async function getRequirementAgingAlertRecipients(requirement) {
    let recruiterIds = [];
    try {
        const parsed = JSON.parse(requirement.recruiters || '[]');
        recruiterIds = Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    }
    catch {
        recruiterIds = [];
    }
    const [hrManagers, recruiters, hiringManagers] = await Promise.all([
        getUserEmailsByRoles(['HR_MANAGER']),
        getUserEmailsByIds(recruiterIds),
        resolveHiringManagerRecipients(requirement.hiringManager),
    ]);
    const seen = new Set();
    const out = [];
    for (const u of [...hrManagers, ...recruiters.map((r) => ({ email: r.email, name: r.name })), ...hiringManagers]) {
        const key = u.email.trim().toLowerCase();
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        out.push({ email: u.email, name: u.name });
    }
    return out;
}
export async function getInterviewerUsers(interviewerIdsJson) {
    let ids = [];
    try {
        ids = JSON.parse(interviewerIdsJson || '[]');
    }
    catch {
        ids = [];
    }
    const users = await getUserEmailsByIds(ids);
    return users.map((u) => ({ email: u.email, name: u.name }));
}
export async function getVendorUserEmails(vendorId) {
    const users = await prisma.user.findMany({
        where: { vendorId, status: 'ACTIVE', role: 'VENDOR' },
        select: { email: true, name: true },
    });
    return users;
}
export async function getUserEmailsByRoles(roles) {
    const users = await prisma.user.findMany({
        where: { role: { in: roles }, status: 'ACTIVE' },
        select: { email: true, name: true },
    });
    return users;
}
/** Hiring manager, account manager, and leadership for business requirement stage alerts. */
export async function getBusinessRequirementStageNotificationRecipients(businessReq) {
    return getBusinessRequirementNotificationRecipients(businessReq, [
        'SUPER_ADMIN',
        'ADMIN',
        'HR_MANAGER',
        'HR_HEAD',
    ]);
}
/** Recipients when a role is added on a client card after SOW. */
export async function getLinkedRequirementCreatedNotificationRecipients(businessReq) {
    return getBusinessRequirementNotificationRecipients(businessReq, [
        'SUPER_ADMIN',
        'ADMIN',
        'HR_MANAGER',
        'HR_HEAD',
    ]);
}
async function getBusinessRequirementNotificationRecipients(businessReq, roles) {
    const stakeholderIds = [businessReq.accountManager, businessReq.hiringManager].filter(Boolean);
    const [stakeholders, roleUsers] = await Promise.all([
        getUserEmailsByIds(stakeholderIds),
        getUserEmailsByRoles(roles),
    ]);
    const seen = new Set();
    const out = [];
    for (const u of [...stakeholders, ...roleUsers]) {
        if (!u.email || seen.has(u.email))
            continue;
        seen.add(u.email);
        out.push({ email: u.email, name: u.name });
    }
    return out;
}
