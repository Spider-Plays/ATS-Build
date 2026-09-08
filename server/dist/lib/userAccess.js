import { prisma } from './prisma.js';
import { buildCandidateListWhere, parseInterviewerIds } from './candidateAccess.js';
import { hasOrgWideAccess } from './orgAccess.js';
import { parseRecruiterIds, requirementIdsForAuth } from './requirementAccess.js';
/** Roles that may appear in interviewer scheduling pickers. */
const SCHEDULABLE_STAFF_ROLES = [
    'INTERVIEWER',
    'HIRING_MANAGER',
    'ACCOUNT_MANAGER',
    'TEAM_LEAD',
    'RECRUITER',
    'HR_MANAGER',
    'HR_HEAD',
    'ADMIN',
    'SUPER_ADMIN',
];
export async function buildUserListWhere(auth) {
    if (hasOrgWideAccess(auth.role)) {
        return {};
    }
    const userIds = new Set([auth.userId]);
    const reqIds = await requirementIdsForAuth(auth);
    if (reqIds.length > 0) {
        const requirements = await prisma.requirement.findMany({
            where: { id: { in: reqIds } },
            select: { createdBy: true, recruiters: true },
        });
        for (const req of requirements) {
            if (req.createdBy)
                userIds.add(req.createdBy);
            for (const id of parseRecruiterIds(req.recruiters)) {
                userIds.add(id);
            }
        }
    }
    const candidateWhere = await buildCandidateListWhere(auth);
    const candidates = await prisma.candidate.findMany({
        where: candidateWhere,
        select: { id: true, createdBy: true },
    });
    for (const candidate of candidates) {
        if (candidate.createdBy)
            userIds.add(candidate.createdBy);
    }
    const candidateIds = candidates.map((c) => c.id);
    if (candidateIds.length > 0) {
        const interviews = await prisma.interview.findMany({
            where: { candidateId: { in: candidateIds } },
            select: { interviewerIds: true },
        });
        for (const interview of interviews) {
            for (const id of parseInterviewerIds(interview.interviewerIds)) {
                userIds.add(id);
            }
        }
    }
    return {
        OR: [
            { id: { in: [...userIds] } },
            {
                status: 'ACTIVE',
                role: { in: [...SCHEDULABLE_STAFF_ROLES] },
            },
        ],
    };
}
