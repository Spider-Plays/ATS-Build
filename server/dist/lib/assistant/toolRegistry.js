import { prisma } from '../prisma.js';
import { buildCandidateListWhere, buildInterviewListWhere, buildOfferListWhere, } from '../candidateAccess.js';
import { buildRequirementListWhere } from '../requirementAccess.js';
import { buildVendorListWhere } from '../vendorAccess.js';
import { isInterviewPastEnd } from '../interviewPlan.js';
import { isAdminRole } from '../orgAccess.js';
import { OFFER_VIEW_ROLES, roleMatchesAllowed } from '../roles.js';
import { searchNavCatalog } from './navCatalog.js';
const ROW_LIMIT = 8;
function dayBounds(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}
function formatRoleLabel(role) {
    return role
        .split('_')
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' ');
}
async function toolOpsSummary(auth) {
    const [candidateScope, reqScope, interviewScope] = await Promise.all([
        buildCandidateListWhere(auth),
        buildRequirementListWhere(auth),
        buildInterviewListWhere(auth),
    ]);
    const { start, end } = dayBounds();
    const now = new Date();
    const [candidates, liveReqs, upcoming, today, interviewRows] = await Promise.all([
        prisma.candidate.count({ where: candidateScope }),
        prisma.requirement.count({ where: { AND: [reqScope, { status: 'LIVE' }] } }),
        prisma.interview.count({
            where: { AND: [interviewScope, { status: 'SCHEDULED', scheduledAt: { gt: now } }] },
        }),
        prisma.interview.count({
            where: {
                AND: [
                    interviewScope,
                    { status: { not: 'CANCELLED' }, scheduledAt: { gte: start, lte: end } },
                ],
            },
        }),
        prisma.interview.findMany({
            where: { AND: [interviewScope, { status: { not: 'CANCELLED' } }] },
            take: 80,
            select: { id: true, scheduledAt: true, duration: true, status: true },
        }),
    ]);
    const withFeedback = new Set((await prisma.feedback.findMany({
        where: { interviewId: { in: interviewRows.map((i) => i.id) } },
        select: { interviewId: true },
    })).map((f) => f.interviewId));
    const awaitingFeedback = interviewRows.filter((i) => {
        if (withFeedback.has(i.id))
            return false;
        if (i.status === 'COMPLETED')
            return true;
        return isInterviewPastEnd(i.scheduledAt, i.duration, now);
    }).length;
    let pendingOffers = null;
    if (roleMatchesAllowed(auth.role, OFFER_VIEW_ROLES)) {
        const offerScope = await buildOfferListWhere(auth);
        pendingOffers = await prisma.offer.count({
            where: {
                ...offerScope,
                status: {
                    in: ['PENDING_HR_APPROVAL', 'PENDING_APPROVAL', 'PENDING_EXEC_APPROVAL'],
                },
            },
        });
    }
    return {
        ok: true,
        summary: 'Operational snapshot for the caller’s access scope.',
        data: {
            candidates,
            liveRequirements: liveReqs,
            interviewsToday: today,
            upcomingInterviews: upcoming,
            awaitingFeedback,
            pendingOffers,
        },
        links: [
            { label: 'Dashboard', href: '/' },
            { label: 'Candidates', href: '/candidates' },
            { label: 'Interviews', href: '/interviews' },
        ],
        followUps: [
            'How many candidates in interview?',
            'Interviews awaiting feedback',
            'Open requirements',
        ],
    };
}
async function toolCandidates(auth, args) {
    const scope = await buildCandidateListWhere(auth);
    const status = (args.status || 'ALL').toUpperCase();
    const mode = args.mode === 'list' ? 'list' : 'count';
    const statusWhere = status !== 'ALL' ? { status } : {};
    let textWhere = {};
    if (args.query?.trim()) {
        const q = args.query.trim();
        textWhere = {
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { role: { contains: q, mode: 'insensitive' } },
            ],
        };
    }
    const where = { AND: [scope, statusWhere, textWhere] };
    const total = await prisma.candidate.count({ where });
    if (mode === 'count') {
        return {
            ok: true,
            summary: `Candidate count (${status}).`,
            data: { total, status },
            links: [{ label: 'Candidates', href: '/candidates' }],
            followUps: ['List them', 'How many in screening?'],
        };
    }
    const rows = await prisma.candidate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: ROW_LIMIT,
        select: { id: true, name: true, email: true, status: true, role: true },
    });
    const items = rows.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.status} · ${c.email}`,
        href: `/candidates/${c.id}`,
    }));
    return {
        ok: true,
        summary: `Listed ${items.length} of ${total} candidates.`,
        data: { total, status },
        items,
        links: [{ label: 'All candidates', href: '/candidates' }],
    };
}
async function toolRequirements(auth, args) {
    const scope = await buildRequirementListWhere(auth);
    const status = (args.status || 'LIVE').toUpperCase();
    const mode = args.mode === 'list' ? 'list' : args.mode === 'count' ? 'count' : 'list';
    const where = { AND: [scope, { status }] };
    const total = await prisma.requirement.count({ where });
    if (mode === 'count') {
        return {
            ok: true,
            summary: `Requirement count with status ${status}.`,
            data: { total, status },
            links: [{ label: 'Requirements', href: '/requirements' }],
            followUps: ['List them', 'Pending requirement approvals'],
        };
    }
    const rows = await prisma.requirement.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: ROW_LIMIT,
        select: {
            id: true,
            title: true,
            jobCode: true,
            client: true,
            openings: true,
            filled: true,
            status: true,
        },
    });
    const items = rows.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: `${r.jobCode}${r.client ? ` · ${r.client}` : ''} · ${r.status}`,
        href: `/requirements/${r.id}`,
    }));
    return {
        ok: true,
        summary: `Listed ${items.length} of ${total} requirements (${status}).`,
        data: { total, status },
        items,
        links: [{ label: 'Requirements', href: '/requirements' }],
    };
}
async function toolInterviews(auth, args) {
    const filter = (args.filter || 'upcoming').toLowerCase();
    const scope = await buildInterviewListWhere(auth);
    const now = new Date();
    const { start, end } = dayBounds(now);
    if (filter === 'awaiting_feedback' || filter === 'feedback') {
        const interviews = await prisma.interview.findMany({
            where: { AND: [scope, { status: { not: 'CANCELLED' } }] },
            orderBy: { scheduledAt: 'desc' },
            take: 80,
            select: {
                id: true,
                scheduledAt: true,
                duration: true,
                status: true,
                type: true,
                candidateId: true,
            },
        });
        const withFeedback = new Set((await prisma.feedback.findMany({
            where: { interviewId: { in: interviews.map((i) => i.id) } },
            select: { interviewId: true },
        })).map((f) => f.interviewId));
        const awaiting = interviews.filter((i) => {
            if (withFeedback.has(i.id))
                return false;
            if (i.status === 'COMPLETED')
                return true;
            return isInterviewPastEnd(i.scheduledAt, i.duration, now);
        });
        const slice = awaiting.slice(0, ROW_LIMIT);
        const candidates = await prisma.candidate.findMany({
            where: { id: { in: [...new Set(slice.map((i) => i.candidateId))] } },
            select: { id: true, name: true },
        });
        const byId = new Map(candidates.map((c) => [c.id, c]));
        const items = slice.map((i) => ({
            id: i.id,
            title: byId.get(i.candidateId)?.name ?? 'Candidate',
            subtitle: `${i.type} · ${new Date(i.scheduledAt).toLocaleString()}`,
            href: `/interviews/${i.id}/feedback`,
        }));
        return {
            ok: true,
            summary: `${awaiting.length} interview(s) awaiting feedback.`,
            data: { total: awaiting.length },
            items,
            links: [{ label: 'Feedback queue', href: '/interviews?filter=feedback' }],
        };
    }
    const where = filter === 'today'
        ? {
            AND: [
                scope,
                { status: { not: 'CANCELLED' }, scheduledAt: { gte: start, lte: end } },
            ],
        }
        : {
            AND: [scope, { status: 'SCHEDULED', scheduledAt: { gt: now } }],
        };
    const total = await prisma.interview.count({ where });
    const rows = await prisma.interview.findMany({
        where,
        orderBy: { scheduledAt: 'asc' },
        take: ROW_LIMIT,
        select: { id: true, scheduledAt: true, type: true, candidateId: true },
    });
    const candidates = await prisma.candidate.findMany({
        where: { id: { in: [...new Set(rows.map((i) => i.candidateId))] } },
        select: { id: true, name: true },
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const items = rows.map((i) => ({
        id: i.id,
        title: byId.get(i.candidateId)?.name ?? 'Candidate',
        subtitle: `${i.type} · ${new Date(i.scheduledAt).toLocaleString()}`,
        href: '/interviews',
    }));
    return {
        ok: true,
        summary: `${total} ${filter} interview(s).`,
        data: { total, filter },
        items,
        links: [
            {
                label: 'Interviews',
                href: filter === 'today' ? '/interviews?filter=today' : '/interviews?filter=upcoming',
            },
        ],
    };
}
async function toolOffers(auth, args) {
    if (!roleMatchesAllowed(auth.role, OFFER_VIEW_ROLES)) {
        return {
            ok: false,
            summary: 'Caller role cannot view offers.',
            links: [{ label: 'Dashboard', href: '/' }],
        };
    }
    const step = (args.step || 'all').toLowerCase();
    const scope = await buildOfferListWhere(auth);
    let statusFilter;
    if (step === 'exec')
        statusFilter = 'PENDING_EXEC_APPROVAL';
    else if (step === 'chain')
        statusFilter = 'PENDING_APPROVAL';
    else if (step === 'hr')
        statusFilter = { in: ['PENDING_HR_APPROVAL', 'PENDING_APPROVAL'] };
    else {
        statusFilter = {
            in: ['PENDING_HR_APPROVAL', 'PENDING_APPROVAL', 'PENDING_EXEC_APPROVAL'],
        };
    }
    const where = { ...scope, status: statusFilter };
    const total = await prisma.offer.count({ where });
    const rows = await prisma.offer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: ROW_LIMIT,
        select: { id: true, status: true, candidateId: true },
    });
    const candidates = await prisma.candidate.findMany({
        where: { id: { in: [...new Set(rows.map((o) => o.candidateId))] } },
        select: { id: true, name: true },
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const items = rows.map((o) => ({
        id: o.id,
        title: byId.get(o.candidateId)?.name ?? 'Candidate',
        subtitle: o.status.replace(/_/g, ' '),
        href: `/offers/${o.id}`,
    }));
    return {
        ok: true,
        summary: `${total} offer(s) pending (${step}).`,
        data: { total, step },
        items,
        links: [{ label: 'Offers', href: '/offers' }],
        followUps: ['Offers pending exec', 'How many candidates in offer?'],
    };
}
async function toolPortalUsers(auth, args) {
    if (!isAdminRole(auth.role)) {
        return {
            ok: false,
            summary: 'Portal user totals are admin-only.',
            links: [{ label: 'Dashboard', href: '/' }],
        };
    }
    const roleFilter = args.role?.toUpperCase();
    if (roleFilter) {
        const [total, active] = await Promise.all([
            prisma.user.count({ where: { role: roleFilter } }),
            prisma.user.count({ where: { role: roleFilter, status: 'ACTIVE' } }),
        ]);
        return {
            ok: true,
            summary: `${total} ${formatRoleLabel(roleFilter)} account(s) (${active} active).`,
            data: { total, active, role: roleFilter },
            links: [{ label: 'User management', href: '/admin/users' }],
        };
    }
    const [total, active, byRole] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: 'ACTIVE' } }),
        prisma.user.groupBy({
            by: ['role'],
            _count: { _all: true },
            orderBy: { _count: { role: 'desc' } },
        }),
    ]);
    return {
        ok: true,
        summary: `${total} portal users (${active} active).`,
        data: {
            total,
            active,
            byRole: byRole.map((r) => ({ role: r.role, count: r._count._all })),
        },
        links: [{ label: 'User management', href: '/admin/users' }],
    };
}
async function toolVendors(auth) {
    const scope = await buildVendorListWhere(auth);
    const [total, active] = await Promise.all([
        prisma.vendor.count({ where: scope }),
        prisma.vendor.count({ where: { AND: [scope, { status: 'ACTIVE' }] } }),
    ]);
    const rows = await prisma.vendor.findMany({
        where: { AND: [scope, { status: 'ACTIVE' }] },
        orderBy: { name: 'asc' },
        take: ROW_LIMIT,
        select: { id: true, name: true, email: true, status: true },
    });
    const items = rows.map((v) => ({
        id: v.id,
        title: v.name,
        subtitle: `${v.status} · ${v.email}`,
        href: `/vendors/${v.id}`,
    }));
    return {
        ok: true,
        summary: `${total} vendor(s) (${active} active).`,
        data: { total, active },
        items,
        links: [{ label: 'Vendors', href: '/vendors' }],
    };
}
async function toolChangeRequests(auth) {
    const role = auth.role;
    const userId = auth.userId;
    let where;
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
        where = { status: { in: ['PENDING_HR', 'PENDING_ADMIN'] } };
    }
    else if (role === 'HR_HEAD' || role === 'HR_MANAGER') {
        where = { OR: [{ status: 'PENDING_HR' }, { requestedBy: userId }] };
    }
    else {
        where = { requestedBy: userId, status: { notIn: ['CLOSED', 'REJECTED', 'DEFERRED', 'DUPLICATE', 'WONT_FIX'] } };
    }
    const total = await prisma.changeRequest.count({ where });
    const rows = await prisma.changeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: ROW_LIMIT,
        select: { id: true, title: true, status: true, module: true },
    });
    const items = rows.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: `${r.status.replace(/_/g, ' ')} · ${r.module}`,
        href: `/self-service/change-requests/${r.id}`,
    }));
    return {
        ok: true,
        summary: `${total} open change request(s).`,
        data: { total },
        items,
        links: [{ label: 'Change requests', href: '/self-service/change-requests' }],
    };
}
async function toolSearch(auth, args) {
    const q = (args.query || '').trim();
    if (q.length < 2) {
        return { ok: false, summary: 'Search query must be at least 2 characters.' };
    }
    const [candidateScope, requirementScope] = await Promise.all([
        buildCandidateListWhere(auth),
        buildRequirementListWhere(auth),
    ]);
    const textMatch = {
        OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { role: { contains: q, mode: 'insensitive' } },
            { jobTitle: { contains: q, mode: 'insensitive' } },
        ],
    };
    const [candidates, requirements] = await Promise.all([
        auth.role === 'INTERVIEWER'
            ? Promise.resolve([])
            : prisma.candidate.findMany({
                where: { AND: [candidateScope, textMatch] },
                take: ROW_LIMIT,
                orderBy: { updatedAt: 'desc' },
                select: { id: true, name: true, email: true, status: true },
            }),
        prisma.requirement.findMany({
            where: {
                AND: [
                    requirementScope,
                    {
                        OR: [
                            { title: { contains: q, mode: 'insensitive' } },
                            { jobCode: { contains: q, mode: 'insensitive' } },
                            { department: { contains: q, mode: 'insensitive' } },
                            { client: { contains: q, mode: 'insensitive' } },
                        ],
                    },
                ],
            },
            take: ROW_LIMIT,
            orderBy: { updatedAt: 'desc' },
            select: { id: true, title: true, jobCode: true, status: true },
        }),
    ]);
    const items = [
        ...candidates.map((c) => ({
            id: c.id,
            title: c.name,
            subtitle: `${c.status} · ${c.email}`,
            href: `/candidates/${c.id}`,
        })),
        ...requirements.map((r) => ({
            id: r.id,
            title: r.title,
            subtitle: `${r.jobCode} · ${r.status}`,
            href: `/requirements/${r.id}`,
        })),
    ];
    return {
        ok: true,
        summary: items.length
            ? `Found ${items.length} match(es) for “${q}”.`
            : `No matches for “${q}” in caller access.`,
        items,
        data: { query: q, count: items.length },
        links: [{ label: 'Dashboard', href: '/' }],
    };
}
function toolNavGuide(auth, args) {
    const entries = searchNavCatalog(auth.role, args.query);
    const items = entries.map((e) => ({
        id: e.id,
        title: e.title,
        subtitle: e.description,
        href: e.href,
    }));
    return {
        ok: true,
        summary: entries.length
            ? `Navigation matches for “${args.query || 'general'}”.`
            : 'No navigation matches.',
        items,
        links: entries.slice(0, 4).map((e) => ({ label: e.title, href: e.href })),
        followUps: ['Give me a quick overview', 'How many candidates in interview?'],
    };
}
export const ASSISTANT_GROQ_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'ops_summary',
            description: 'Get a snapshot of candidates, live jobs, interviews, feedback queue, and pending offers in the caller scope.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'count_or_list_candidates',
            description: 'Count or list candidates. Optional status: ALL, SUBMITTED, SCREENING, SHORTLISTED, INTERVIEW, OFFER, HIRED, REJECTED, ON_HOLD. mode=count|list. Optional name/email query.',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string' },
                    mode: { type: 'string', enum: ['count', 'list'] },
                    query: { type: 'string' },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'count_or_list_requirements',
            description: 'Count or list requirements/jobs. status defaults to LIVE; use PENDING_APPROVAL for jobs awaiting approval. mode=count|list.',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string' },
                    mode: { type: 'string', enum: ['count', 'list'] },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_interviews',
            description: 'List interviews. filter=today|upcoming|awaiting_feedback.',
            parameters: {
                type: 'object',
                properties: {
                    filter: {
                        type: 'string',
                        enum: ['today', 'upcoming', 'awaiting_feedback'],
                    },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_offers',
            description: 'List offers pending approval. step=all|hr|exec|chain.',
            parameters: {
                type: 'object',
                properties: {
                    step: { type: 'string', enum: ['all', 'hr', 'exec', 'chain'] },
                },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'count_portal_users',
            description: 'Admin only. Count portal users overall or by role (RECRUITER, INTERVIEWER, ADMIN, etc.).',
            parameters: {
                type: 'object',
                properties: { role: { type: 'string' } },
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'count_or_list_vendors',
            description: 'Count and list vendors visible to the caller.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_change_requests',
            description: 'List open change requests in the caller’s queue.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_entities',
            description: 'Search candidates and requirements by name, email, or job code.',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                required: ['query'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'app_navigation_guide',
            description: 'Find where to go in the ATS UI for a task (approve offers, manage users, feedback queue, reports, etc.). Use for how-to / where-is questions. Does not store company policies.',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string' } },
                additionalProperties: false,
            },
        },
    },
];
export async function executeAssistantTool(auth, name, rawArgs) {
    let args = {};
    try {
        const parsed = rawArgs?.trim() ? JSON.parse(rawArgs) : {};
        args =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed
                : {};
    }
    catch {
        return { ok: false, summary: 'Invalid tool arguments JSON.' };
    }
    switch (name) {
        case 'ops_summary':
            return toolOpsSummary(auth);
        case 'count_or_list_candidates':
            return toolCandidates(auth, {
                status: typeof args.status === 'string' ? args.status : undefined,
                mode: typeof args.mode === 'string' ? args.mode : undefined,
                query: typeof args.query === 'string' ? args.query : undefined,
            });
        case 'count_or_list_requirements':
            return toolRequirements(auth, {
                status: typeof args.status === 'string' ? args.status : undefined,
                mode: typeof args.mode === 'string' ? args.mode : undefined,
            });
        case 'list_interviews':
            return toolInterviews(auth, {
                filter: typeof args.filter === 'string' ? args.filter : undefined,
            });
        case 'list_offers':
            return toolOffers(auth, {
                step: typeof args.step === 'string' ? args.step : undefined,
            });
        case 'count_portal_users':
            return toolPortalUsers(auth, {
                role: typeof args.role === 'string' ? args.role : undefined,
            });
        case 'count_or_list_vendors':
            return toolVendors(auth);
        case 'list_change_requests':
            return toolChangeRequests(auth);
        case 'search_entities':
            return toolSearch(auth, {
                query: typeof args.query === 'string' ? args.query : undefined,
            });
        case 'app_navigation_guide':
            return toolNavGuide(auth, {
                query: typeof args.query === 'string' ? args.query : undefined,
            });
        default:
            return { ok: false, summary: `Unknown tool: ${name}` };
    }
}
