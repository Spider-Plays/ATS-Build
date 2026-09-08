import { prisma } from './prisma.js';
import { CAREERS_CANDIDATE_WHERE, ERP_CANDIDATE_WHERE, VENDOR_SUBMISSION_CANDIDATE_WHERE, } from './featureCandidates.js';
import { hasOrgWideAccess } from './orgAccess.js';
import { parseRecruiterIds, requirementIdsForAuth, requirementIdsForInterviewer, requirementVisibleToAuth } from './requirementAccess.js';
import { hasFeatureTag, parseFeatureTags } from './userTags.js';
export class CandidateAccessError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CandidateAccessError';
    }
}
export function parseInterviewerIds(raw) {
    try {
        const ids = JSON.parse(raw || '[]');
        return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    }
    catch {
        return [];
    }
}
export async function isInterviewerAssignedToCandidate(userId, candidateId) {
    const interviews = await prisma.interview.findMany({
        where: { candidateId },
        select: { interviewerIds: true, status: true },
    });
    return interviews.some((i) => i.status !== 'CANCELLED' &&
        parseInterviewerIds(i.interviewerIds).includes(userId));
}
async function featureTagScopeClauses(auth) {
    const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { permissions: true },
    });
    const tags = parseFeatureTags(user?.permissions);
    const clauses = [];
    if (hasFeatureTag(auth.role, tags, 'careers')) {
        clauses.push(CAREERS_CANDIDATE_WHERE);
    }
    if (hasFeatureTag(auth.role, tags, 'employee_referral')) {
        clauses.push(ERP_CANDIDATE_WHERE);
    }
    if (hasFeatureTag(auth.role, tags, 'vendor_submission')) {
        clauses.push(VENDOR_SUBMISSION_CANDIDATE_WHERE);
    }
    return clauses;
}
function withFeatureScopes(base, scopes) {
    if (scopes.length === 0)
        return base;
    return { OR: [base, ...scopes] };
}
/** Org-wide roles see all candidates; others are scoped by role, assignments, and feature tags. */
export async function buildCandidateListWhere(auth) {
    if (hasOrgWideAccess(auth.role)) {
        return {};
    }
    const tagScopes = await featureTagScopeClauses(auth);
    if (auth.role === 'INTERVIEWER') {
        const ids = await candidateIdsForInterviewer(auth.userId);
        const base = ids.length > 0 ? { id: { in: ids } } : { id: { in: ['__none__'] } };
        return withFeatureScopes(base, tagScopes);
    }
    const own = { createdBy: auth.userId };
    if (auth.role === 'RECRUITER') {
        return withFeatureScopes({ createdBy: auth.userId }, tagScopes);
    }
    const reqIds = await requirementIdsForAuth(auth);
    const base = reqIds.length === 0
        ? own
        : { OR: [own, { requirementId: { in: reqIds } }] };
    return withFeatureScopes(base, tagScopes);
}
/**
 * Candidates eligible for AI matching on a requirement.
 * Includes the normal list scope plus all unlinked candidates when the user can work that requirement.
 */
export async function buildCandidateMatchPoolWhere(auth, requirementId) {
    const listWhere = await buildCandidateListWhere(auth);
    if (hasOrgWideAccess(auth.role)) {
        return {};
    }
    const requirement = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: {
            id: true,
            createdBy: true,
            hiringManager: true,
            accountManager: true,
            recruiters: true,
            status: true,
        },
    });
    if (!requirement) {
        return listWhere;
    }
    // Only accepted assignees get the unlinked candidate pool for linking.
    if ((auth.role === 'RECRUITER' || auth.role === 'TEAM_LEAD') &&
        !parseRecruiterIds(requirement.recruiters).includes(auth.userId)) {
        return listWhere;
    }
    const interviewerReqIds = auth.role === 'INTERVIEWER'
        ? new Set(await requirementIdsForInterviewer(auth.userId))
        : undefined;
    if (!requirementVisibleToAuth(auth, requirement, interviewerReqIds, {
        includeOpenBook: true,
    })) {
        return listWhere;
    }
    return { OR: [listWhere, { requirementId: null }] };
}
export async function canViewCandidate(auth, candidateId) {
    const where = await buildCandidateListWhere(auth);
    // AND — interviewers get { id: { in: [...] } } which must not overwrite candidateId.
    const row = await prisma.candidate.findFirst({
        where: { AND: [{ id: candidateId }, where] },
        select: { id: true },
    });
    return !!row;
}
export async function assertCanViewCandidate(auth, candidateId) {
    const ok = await canViewCandidate(auth, candidateId);
    if (!ok) {
        throw new CandidateAccessError('Not allowed to view this candidate');
    }
}
export async function assertCanMutateCandidate(auth, candidateId) {
    await assertCanViewCandidate(auth, candidateId);
}
export async function candidateIdsForInterviewer(userId) {
    const interviews = await prisma.interview.findMany({
        select: { candidateId: true, interviewerIds: true, status: true },
    });
    const ids = new Set();
    for (const i of interviews) {
        if (i.status === 'CANCELLED')
            continue;
        if (parseInterviewerIds(i.interviewerIds).includes(userId)) {
            ids.add(i.candidateId);
        }
    }
    return [...ids];
}
export async function interviewIdsForInterviewer(userId) {
    const interviews = await prisma.interview.findMany({
        select: { id: true, interviewerIds: true, status: true },
    });
    const ids = [];
    for (const i of interviews) {
        if (i.status === 'CANCELLED')
            continue;
        if (parseInterviewerIds(i.interviewerIds).includes(userId)) {
            ids.push(i.id);
        }
    }
    return ids;
}
export async function buildInterviewListWhere(auth) {
    if (hasOrgWideAccess(auth.role))
        return {};
    if (auth.role === 'INTERVIEWER') {
        const ids = await interviewIdsForInterviewer(auth.userId);
        return ids.length > 0 ? { id: { in: ids } } : { id: { in: ['__none__'] } };
    }
    // Recruiters / team leads / managers see interviews for candidates in their
    // candidate scope (same as pipeline). Do not require scheduledBy — that hid
    // seeded rows and interviews scheduled by colleagues on shared candidates.
    const candidateWhere = await buildCandidateListWhere(auth);
    const candidates = await prisma.candidate.findMany({
        where: candidateWhere,
        select: { id: true },
    });
    const candidateIds = candidates.map((c) => c.id);
    return candidateIds.length > 0
        ? { candidateId: { in: candidateIds } }
        : { candidateId: { in: ['__none__'] } };
}
export async function canViewInterview(auth, interviewId) {
    const where = await buildInterviewListWhere(auth);
    // AND — interviewers get { id: { in: [...] } } which must not overwrite interviewId.
    const row = await prisma.interview.findFirst({
        where: { AND: [{ id: interviewId }, where] },
        select: { id: true },
    });
    return !!row;
}
export async function assertCanViewInterview(auth, interviewId) {
    const ok = await canViewInterview(auth, interviewId);
    if (!ok) {
        throw new CandidateAccessError('Not allowed to view this interview');
    }
}
export async function buildOfferListWhere(auth) {
    if (hasOrgWideAccess(auth.role))
        return {};
    const candidateWhere = await buildCandidateListWhere(auth);
    const candidates = await prisma.candidate.findMany({
        where: candidateWhere,
        select: { id: true },
    });
    const candidateIds = candidates.map((c) => c.id);
    const candidateFilter = candidateIds.length > 0
        ? { candidateId: { in: candidateIds } }
        : { candidateId: { in: ['__none__'] } };
    return candidateFilter;
}
export async function canViewOffer(auth, offerId) {
    const where = await buildOfferListWhere(auth);
    const row = await prisma.offer.findFirst({
        where: { AND: [{ id: offerId }, where] },
        select: { id: true },
    });
    return !!row;
}
export async function assertCanViewOffer(auth, offerId) {
    const ok = await canViewOffer(auth, offerId);
    if (!ok) {
        throw new CandidateAccessError('Not allowed to view this offer');
    }
}
/** Candidate-profile activity actions visible to assigned interviewers. */
export const INTERVIEWER_VISIBLE_CANDIDATE_ACTIONS = [
    'INTERVIEW_SCHEDULED',
    'INTERVIEW_RESCHEDULED',
    'INTERVIEW_UPDATED',
    'INTERVIEW_CANCELLED',
    'INTERVIEW_FEEDBACK_DELETED',
];
