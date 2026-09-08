import { prisma } from './prisma.js';
import { businessRequirementIdsForStakeholder, canViewBusinessRequirement, } from './businessRequirementAccess.js';
import { assertCanViewCandidate, buildCandidateListWhere, interviewIdsForInterviewer, INTERVIEWER_VISIBLE_CANDIDATE_ACTIONS, } from './candidateAccess.js';
import { hasOrgWideAccess, isSuperAdminRole } from './orgAccess.js';
import { assertCanViewRequirement, requirementIdsForAuth } from './requirementAccess.js';
/** Stage changes trigger email alerts to stakeholders + super admin. */
export const BUSINESS_STAGE_NOTIFY_ACTIONS = ['STAGE_CHANGED', 'SOW_SIGNED'];
async function visibleCandidateIds(auth) {
    const where = await buildCandidateListWhere(auth);
    const rows = await prisma.candidate.findMany({ where, select: { id: true } });
    return rows.map((r) => r.id);
}
async function visibleInterviewIds(auth) {
    if (auth.role === 'INTERVIEWER') {
        return interviewIdsForInterviewer(auth.userId);
    }
    const candidateIds = await visibleCandidateIds(auth);
    if (candidateIds.length === 0)
        return [];
    const rows = await prisma.interview.findMany({
        where: { candidateId: { in: candidateIds } },
        select: { id: true },
    });
    return rows.map((r) => r.id);
}
async function offerIdsForCandidates(candidateIds) {
    if (candidateIds.length === 0)
        return [];
    const rows = await prisma.offer.findMany({
        where: { candidateId: { in: candidateIds } },
        select: { id: true },
    });
    return rows.map((r) => r.id);
}
async function candidateIdsForRequirements(requirementIds) {
    if (requirementIds.length === 0)
        return [];
    const rows = await prisma.candidate.findMany({
        where: { requirementId: { in: requirementIds } },
        select: { id: true },
    });
    return rows.map((r) => r.id);
}
async function scopedActivityWhere(auth) {
    if (hasOrgWideAccess(auth.role)) {
        return {};
    }
    // Business stakeholders: their BRs + owned requirements + full hiring pipeline on those roles.
    if (auth.role === 'ACCOUNT_MANAGER' || auth.role === 'HIRING_MANAGER') {
        const [businessReqIds, requirementIds] = await Promise.all([
            businessRequirementIdsForStakeholder(auth.userId),
            requirementIdsForAuth(auth),
        ]);
        const or = [];
        if (businessReqIds.length > 0) {
            or.push({
                entityType: 'BUSINESS_REQUIREMENT',
                entityId: { in: businessReqIds },
            });
        }
        if (requirementIds.length > 0) {
            or.push({ entityType: 'REQUIREMENT', entityId: { in: requirementIds } });
            const candidateIds = await candidateIdsForRequirements(requirementIds);
            if (candidateIds.length > 0) {
                or.push({ entityType: 'CANDIDATE', entityId: { in: candidateIds } });
                const [interviewIds, offerIds] = await Promise.all([
                    prisma.interview
                        .findMany({ where: { candidateId: { in: candidateIds } }, select: { id: true } })
                        .then((rows) => rows.map((r) => r.id)),
                    offerIdsForCandidates(candidateIds),
                ]);
                if (interviewIds.length > 0) {
                    or.push({ entityType: 'INTERVIEW', entityId: { in: interviewIds } });
                }
                if (offerIds.length > 0) {
                    or.push({ entityType: 'OFFER', entityId: { in: offerIds } });
                }
            }
        }
        return or.length > 0 ? { OR: or } : { id: { in: ['__none__'] } };
    }
    const [candidateIds, requirementIds, interviewIds] = await Promise.all([
        visibleCandidateIds(auth),
        requirementIdsForAuth(auth),
        visibleInterviewIds(auth),
    ]);
    const or = [];
    if (auth.role === 'INTERVIEWER') {
        if (interviewIds.length > 0) {
            or.push({ entityType: 'INTERVIEW', entityId: { in: interviewIds } });
        }
        if (candidateIds.length > 0) {
            or.push({
                entityType: 'CANDIDATE',
                entityId: { in: candidateIds },
                action: { in: [...INTERVIEWER_VISIBLE_CANDIDATE_ACTIONS] },
            });
        }
        return or.length > 0 ? { OR: or } : { id: { in: ['__none__'] } };
    }
    if (candidateIds.length > 0) {
        or.push({ entityType: 'CANDIDATE', entityId: { in: candidateIds } });
    }
    if (requirementIds.length > 0) {
        or.push({ entityType: 'REQUIREMENT', entityId: { in: requirementIds } });
    }
    if (interviewIds.length > 0) {
        or.push({ entityType: 'INTERVIEW', entityId: { in: interviewIds } });
    }
    // Recruiters / team leads / etc. also see offers on candidates they can access.
    const offerIds = await offerIdsForCandidates(candidateIds);
    if (offerIds.length > 0) {
        or.push({ entityType: 'OFFER', entityId: { in: offerIds } });
    }
    return or.length > 0 ? { OR: or } : { id: { in: ['__none__'] } };
}
/** Entity types shown in the shared staff notification inbox (non–super-admin). */
const INBOX_ACTIVITY_ENTITY_TYPES = new Set([
    'CANDIDATE',
    'REQUIREMENT',
    'INTERVIEW',
    'OFFER',
    'BUSINESS_REQUIREMENT',
    'CLIENT_DEAL',
]);
function isInboxActivityEntityType(entityType) {
    return INBOX_ACTIVITY_ENTITY_TYPES.has(entityType);
}
function isBusinessRequirementActivityLog(log) {
    return log.entityType === 'BUSINESS_REQUIREMENT';
}
async function allowedBusinessRequirementIdsForAuth(auth, entityIds) {
    if (entityIds.length === 0)
        return new Set();
    if (isSuperAdminRole(auth.role))
        return new Set(entityIds);
    const rows = await prisma.businessRequirement.findMany({
        where: { id: { in: entityIds } },
        select: { id: true, accountManager: true, hiringManager: true, createdBy: true },
    });
    return new Set(rows
        .filter((r) => r.accountManager === auth.userId ||
        r.hiringManager === auth.userId ||
        r.createdBy === auth.userId)
        .map((r) => r.id));
}
async function filterBusinessRequirementLogsForAuth(auth, logs) {
    const bizLogs = logs.filter(isBusinessRequirementActivityLog);
    if (bizLogs.length === 0)
        return logs;
    if (isSuperAdminRole(auth.role) || hasOrgWideAccess(auth.role))
        return logs;
    const allowed = await allowedBusinessRequirementIdsForAuth(auth, [...new Set(bizLogs.map((l) => l.entityId))]);
    return logs.filter((log) => {
        if (!isBusinessRequirementActivityLog(log))
            return true;
        return allowed.has(log.entityId);
    });
}
async function filterActivityLogsForAuth(auth, logs) {
    let filtered = logs;
    if (!isSuperAdminRole(auth.role)) {
        filtered = filtered.filter((log) => isInboxActivityEntityType(log.entityType));
    }
    return filterBusinessRequirementLogsForAuth(auth, filtered);
}
export async function listActivityLogsForAuth(auth, limit) {
    const where = await scopedActivityWhere(auth);
    const rows = await prisma.activityLog.findMany({
        where: { ...where, seed: false },
        orderBy: { timestamp: 'desc' },
        take: limit,
    });
    return filterActivityLogsForAuth(auth, rows);
}
export async function listActivityLogsForEntity(auth, entityId, limit) {
    if (auth.role === 'INTERVIEWER') {
        await assertCanViewCandidate(auth, entityId);
        return prisma.activityLog.findMany({
            where: {
                entityId,
                entityType: 'CANDIDATE',
                action: { in: [...INTERVIEWER_VISIBLE_CANDIDATE_ACTIONS] },
            },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
    }
    const bizRow = await prisma.businessRequirement.findUnique({
        where: { id: entityId },
        select: {
            id: true,
            createdBy: true,
            accountManager: true,
            hiringManager: true,
        },
    });
    if (bizRow && canViewBusinessRequirement(auth, bizRow)) {
        const rows = await prisma.activityLog.findMany({
            where: { entityId, entityType: 'BUSINESS_REQUIREMENT' },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
        return rows;
    }
    const requirementRow = await prisma.requirement.findUnique({
        where: { id: entityId },
        select: { id: true },
    });
    if (requirementRow) {
        try {
            await assertCanViewRequirement(auth, entityId);
        }
        catch {
            return [];
        }
        return prisma.activityLog.findMany({
            where: { entityId, entityType: 'REQUIREMENT' },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
    }
    const candidateIds = await visibleCandidateIds(auth);
    if (candidateIds.includes(entityId)) {
        return prisma.activityLog.findMany({
            where: { entityId, entityType: 'CANDIDATE' },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
    }
    if (hasOrgWideAccess(auth.role)) {
        return prisma.activityLog.findMany({
            where: { entityId },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
    }
    return [];
}
