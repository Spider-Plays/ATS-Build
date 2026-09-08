import { prisma } from './prisma.js';
import { hasOrgWideAccess } from './orgAccess.js';
import { isRequirementHiringManager } from './requirementPermissions.js';
function parseInterviewerIds(raw) {
    try {
        const ids = JSON.parse(raw || '[]');
        return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    }
    catch {
        return [];
    }
}
export class RequirementAccessError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RequirementAccessError';
    }
}
export function parseRecruiterIds(raw) {
    try {
        const ids = JSON.parse(raw || '[]');
        return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    }
    catch {
        return [];
    }
}
export function requirementVisibleToAuth(auth, requirement, interviewerRequirementIds, options) {
    if (hasOrgWideAccess(auth.role))
        return true;
    const recruiters = parseRecruiterIds(requirement.recruiters);
    const pending = parseRecruiterIds(requirement.pendingRecruiters);
    const assigned = recruiters.includes(auth.userId);
    const invited = options?.includePendingInvite === true && pending.includes(auth.userId);
    const created = requirement.createdBy === auth.userId;
    const openBook = options?.includeOpenBook === true;
    switch (auth.role) {
        case 'RECRUITER':
        case 'TEAM_LEAD':
            return assigned || invited || created || openBook;
        case 'HIRING_MANAGER':
            return created || isRequirementHiringManager(auth, requirement);
        case 'ACCOUNT_MANAGER':
            return requirement.accountManager === auth.userId;
        case 'INTERVIEWER':
            return interviewerRequirementIds?.has(requirement.id) ?? false;
        default:
            return created;
    }
}
export async function requirementIdsForInterviewer(userId) {
    const interviews = await prisma.interview.findMany({
        where: { status: { not: 'CANCELLED' } },
        select: { requirementId: true, interviewerIds: true },
    });
    const ids = new Set();
    for (const i of interviews) {
        if (parseInterviewerIds(i.interviewerIds).includes(userId)) {
            ids.add(i.requirementId);
        }
    }
    return [...ids];
}
/** Assignment-scoped requirement IDs (no org-wide LIVE expansion). */
export async function requirementIdsForAuth(auth) {
    if (hasOrgWideAccess(auth.role)) {
        const rows = await prisma.requirement.findMany({ select: { id: true } });
        return rows.map((r) => r.id);
    }
    const rows = await prisma.requirement.findMany({
        select: {
            id: true,
            createdBy: true,
            hiringManager: true,
            accountManager: true,
            recruiters: true,
            pendingRecruiters: true,
        },
    });
    const interviewerReqIds = auth.role === 'INTERVIEWER'
        ? new Set(await requirementIdsForInterviewer(auth.userId))
        : undefined;
    return rows
        .filter((r) => requirementVisibleToAuth(auth, r, interviewerReqIds))
        .map((r) => r.id);
}
export async function buildRequirementListWhere(auth) {
    if (hasOrgWideAccess(auth.role))
        return {};
    // All recruiters / team leads can browse every requirement;
    // adding profiles is gated separately via assignment.
    if (auth.role === 'RECRUITER' || auth.role === 'TEAM_LEAD') {
        return {};
    }
    const ids = await requirementIdsForAuth(auth);
    return ids.length > 0 ? { id: { in: ids } } : { id: { in: ['__none__'] } };
}
export async function assertCanViewRequirement(auth, requirementId) {
    if (hasOrgWideAccess(auth.role))
        return;
    const row = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: {
            id: true,
            createdBy: true,
            hiringManager: true,
            accountManager: true,
            recruiters: true,
            pendingRecruiters: true,
            status: true,
        },
    });
    if (!row) {
        throw new RequirementAccessError('Requirement not found');
    }
    const interviewerReqIds = auth.role === 'INTERVIEWER'
        ? new Set(await requirementIdsForInterviewer(auth.userId))
        : undefined;
    if (!requirementVisibleToAuth(auth, row, interviewerReqIds, {
        includeOpenBook: true,
        includePendingInvite: true,
    })) {
        throw new RequirementAccessError('Not allowed to view this requirement');
    }
}
/**
 * Only org-wide roles and accepted (assigned) recruiters may add/link
 * candidate profiles to a requirement. Pending invites do not count.
 */
export async function assertCanAddCandidatesToRequirement(auth, requirementId) {
    if (hasOrgWideAccess(auth.role))
        return;
    const row = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: { id: true, recruiters: true },
    });
    if (!row) {
        throw new RequirementAccessError('Requirement not found');
    }
    if (auth.role === 'RECRUITER' || auth.role === 'TEAM_LEAD') {
        const assigned = parseRecruiterIds(row.recruiters);
        if (assigned.includes(auth.userId))
            return;
        throw new RequirementAccessError('Only recruiters assigned to this requirement can add candidate profiles');
    }
    throw new RequirementAccessError('Not allowed to add candidate profiles to this requirement');
}
/** Sync check: accepted assignee (not pending). */
export function isAcceptedRequirementRecruiter(recruitersRaw, userId) {
    return parseRecruiterIds(recruitersRaw).includes(userId);
}
