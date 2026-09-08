import { prisma } from '../prisma.js';
import { buildCandidateListWhere, buildInterviewListWhere, buildOfferListWhere, } from '../candidateAccess.js';
import { buildRequirementListWhere } from '../requirementAccess.js';
import { buildVendorListWhere } from '../vendorAccess.js';
import { isInterviewPastEnd } from '../interviewPlan.js';
import { isAdminRole } from '../orgAccess.js';
import { OFFER_VIEW_ROLES, roleMatchesAllowed } from '../roles.js';
import { ASSISTANT_EXAMPLE_QUESTIONS, followUpsForIntent, matchAssistantIntent, } from './intents.js';
const ROW_LIMIT = 8;
function withMeta(matched, answer) {
    const context = {
        lastIntent: matched.intent,
        candidateStatus: matched.candidateStatus,
        offerStep: matched.offerStep,
        searchQuery: matched.searchQuery,
        userRoleFilter: matched.userRoleFilter,
    };
    return {
        ...answer,
        intent: matched.intent,
        followUps: answer.followUps ?? followUpsForIntent(matched),
        context,
    };
}
function helpAnswer(matched) {
    const examples = ASSISTANT_EXAMPLE_QUESTIONS.map((q) => `• ${q}`).join('\n');
    return withMeta(matched, {
        intent: matched.intent,
        answer: "Happy to help. I look up live ATS numbers for your role — candidates, jobs, interviews, offers, vendors, change requests, and (for admins) portal users.\n\nTry asking:\n" +
            examples +
            '\n\nTip: after a count, say “list them”. I don’t store company policies or handbooks.',
        links: [
            { label: 'Dashboard', href: '/' },
            { label: 'Candidates', href: '/candidates' },
            { label: 'Interviews', href: '/interviews' },
            { label: 'Offers', href: '/offers' },
        ],
    });
}
function greetingAnswer(matched) {
    return withMeta(matched, {
        intent: 'greeting',
        answer: "Hi — I'm your ATS assistant. Ask for counts, lists, or a quick overview of candidates, roles, interviews, and offers.\n\nWhat would you like to check?",
        links: [{ label: 'Dashboard', href: '/' }],
    });
}
function outOfScopeAnswer(matched) {
    const topic = matched.outOfScopeTopic ?? 'that';
    return withMeta(matched, {
        intent: matched.intent,
        answer: `I don’t keep ${topic} inside the ATS — those usually live with HR / company docs outside this app.\n\nI *can* pull live recruiting data though. Want a quick overview, candidate counts, open roles, or pending offers?`,
        links: [
            { label: 'Dashboard', href: '/' },
            { label: 'Candidates', href: '/candidates' },
        ],
    });
}
function formatRoleLabel(role) {
    return role
        .split('_')
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' ');
}
function dayBounds(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}
async function opsSummary(auth, matched) {
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
    let offerLine = '';
    if (roleMatchesAllowed(auth.role, OFFER_VIEW_ROLES)) {
        const offerScope = await buildOfferListWhere(auth);
        const pendingOffers = await prisma.offer.count({
            where: {
                ...offerScope,
                status: {
                    in: ['PENDING_HR_APPROVAL', 'PENDING_APPROVAL', 'PENDING_EXEC_APPROVAL'],
                },
            },
        });
        offerLine = `\n• Pending offers: **${pendingOffers}**`;
    }
    return withMeta(matched, {
        intent: matched.intent,
        answer: `Here’s a quick snapshot in your access:\n` +
            `• Candidates: **${candidates}**\n` +
            `• Live requirements: **${liveReqs}**\n` +
            `• Interviews today: **${today}**\n` +
            `• Upcoming interviews: **${upcoming}**\n` +
            `• Awaiting feedback: **${awaitingFeedback}**` +
            offerLine +
            `\n\nAsk me to drill into any of these.`,
        links: [
            { label: 'Dashboard', href: '/' },
            { label: 'Candidates', href: '/candidates' },
            { label: 'Interviews', href: '/interviews' },
        ],
    });
}
async function countCandidatesByStatus(auth, matched) {
    const status = matched.candidateStatus;
    const scope = await buildCandidateListWhere(auth);
    if (status && status !== 'ALL') {
        const count = await prisma.candidate.count({
            where: { AND: [scope, { status }] },
        });
        const label = status.replace(/_/g, ' ').toLowerCase();
        return withMeta(matched, {
            intent: matched.intent,
            answer: count === 0
                ? `I don't see any candidates in **${label}** for you right now.`
                : `You've got **${count}** candidate${count === 1 ? '' : 's'} in **${label}**. Want me to list them?`,
            links: [{ label: 'View candidates', href: '/candidates' }],
        });
    }
    const count = await prisma.candidate.count({ where: scope });
    return withMeta(matched, {
        intent: matched.intent,
        answer: `Across your access, there ${count === 1 ? 'is' : 'are'} **${count}** candidate${count === 1 ? '' : 's'} in total.`,
        links: [{ label: 'View candidates', href: '/candidates' }],
    });
}
async function listCandidatesByStatus(auth, matched) {
    const status = matched.candidateStatus ?? 'ALL';
    const scope = await buildCandidateListWhere(auth);
    const statusWhere = status !== 'ALL' ? { status } : {};
    const where = { AND: [scope, statusWhere] };
    const total = await prisma.candidate.count({ where });
    const rows = await prisma.candidate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: ROW_LIMIT,
        select: { id: true, name: true, email: true, status: true, role: true },
    });
    const label = status === 'ALL' ? 'in your scope' : `in ${status.replace(/_/g, ' ').toLowerCase()}`;
    const items = rows.map((c) => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.status} · ${c.email}`,
        href: `/candidates/${c.id}`,
    }));
    return withMeta(matched, {
        intent: matched.intent,
        answer: total === 0
            ? `No candidates ${label} right now.`
            : `Here ${total === 1 ? 'is' : 'are'} **${Math.min(total, ROW_LIMIT)}** of **${total}** candidate${total === 1 ? '' : 's'} ${label}:`,
        links: [{ label: 'All candidates', href: '/candidates' }],
        items,
    });
}
async function countOpenRequirements(auth, matched) {
    const scope = await buildRequirementListWhere(auth);
    const count = await prisma.requirement.count({
        where: { AND: [scope, { status: 'LIVE' }] },
    });
    return withMeta(matched, {
        intent: matched.intent,
        answer: count === 0
            ? "There aren't any live requirements in your access at the moment."
            : `There ${count === 1 ? 'is' : 'are'} **${count}** live requirement${count === 1 ? '' : 's'} you can access. Say “list them” if you want titles.`,
        links: [{ label: 'View requirements', href: '/requirements' }],
    });
}
async function listLiveRequirements(auth, matched) {
    const scope = await buildRequirementListWhere(auth);
    const rows = await prisma.requirement.findMany({
        where: { AND: [scope, { status: 'LIVE' }] },
        orderBy: { updatedAt: 'desc' },
        take: ROW_LIMIT,
        select: {
            id: true,
            title: true,
            jobCode: true,
            client: true,
            openings: true,
            filled: true,
        },
    });
    const total = await prisma.requirement.count({
        where: { AND: [scope, { status: 'LIVE' }] },
    });
    const items = rows.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: `${r.jobCode}${r.client ? ` · ${r.client}` : ''} · ${r.filled}/${r.openings} filled`,
        href: `/requirements/${r.id}`,
    }));
    return withMeta(matched, {
        intent: matched.intent,
        answer: total === 0
            ? 'No live requirements in your access scope.'
            : `Here ${total === 1 ? 'is' : 'are'} **${Math.min(total, ROW_LIMIT)}** of **${total}** live requirement${total === 1 ? '' : 's'}:`,
        links: [{ label: 'All requirements', href: '/requirements' }],
        items,
    });
}
async function pendingRequirements(auth, matched) {
    const scope = await buildRequirementListWhere(auth);
    const where = { AND: [scope, { status: 'PENDING_APPROVAL' }] };
    const total = await prisma.requirement.count({ where });
    const rows = await prisma.requirement.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: ROW_LIMIT,
        select: { id: true, title: true, jobCode: true, client: true },
    });
    const items = rows.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: `${r.jobCode}${r.client ? ` · ${r.client}` : ''}`,
        href: `/requirements/${r.id}`,
    }));
    return withMeta(matched, {
        intent: matched.intent,
        answer: total === 0
            ? 'No requirements waiting on approval in your access.'
            : `There ${total === 1 ? 'is' : 'are'} **${total}** requirement${total === 1 ? '' : 's'} pending approval:`,
        links: [{ label: 'Requirements', href: '/requirements' }],
        items,
    });
}
async function interviewsAwaitingFeedback(auth, matched) {
    const scope = await buildInterviewListWhere(auth);
    const now = new Date();
    const interviews = await prisma.interview.findMany({
        where: {
            AND: [scope, { status: { not: 'CANCELLED' } }],
        },
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
    const ids = interviews.map((i) => i.id);
    const withFeedback = new Set((await prisma.feedback.findMany({
        where: { interviewId: { in: ids } },
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
    const candidateIds = [...new Set(slice.map((i) => i.candidateId))];
    const candidates = await prisma.candidate.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, name: true, role: true },
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const items = slice.map((i) => {
        const c = byId.get(i.candidateId);
        return {
            id: i.id,
            title: c?.name ?? 'Candidate',
            subtitle: `${i.type} · ${new Date(i.scheduledAt).toLocaleString()}`,
            href: `/interviews/${i.id}/feedback`,
        };
    });
    return withMeta(matched, {
        intent: matched.intent,
        answer: awaiting.length === 0
            ? 'Nice — nothing is waiting on feedback in your queue.'
            : `There ${awaiting.length === 1 ? 'is' : 'are'} **${awaiting.length}** interview${awaiting.length === 1 ? '' : 's'} waiting for feedback:`,
        links: [{ label: 'Interviews / feedback', href: '/interviews?filter=feedback' }],
        items,
    });
}
async function interviewsInWindow(auth, matched, mode) {
    const scope = await buildInterviewListWhere(auth);
    const now = new Date();
    const { start, end } = dayBounds(now);
    const where = mode === 'today'
        ? {
            AND: [
                scope,
                { status: { not: 'CANCELLED' }, scheduledAt: { gte: start, lte: end } },
            ],
        }
        : {
            AND: [scope, { status: 'SCHEDULED', scheduledAt: { gt: now } }],
        };
    const rows = await prisma.interview.findMany({
        where,
        orderBy: { scheduledAt: 'asc' },
        take: ROW_LIMIT,
        select: {
            id: true,
            scheduledAt: true,
            type: true,
            candidateId: true,
        },
    });
    const total = await prisma.interview.count({ where });
    const candidateIds = [...new Set(rows.map((i) => i.candidateId))];
    const candidates = await prisma.candidate.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, name: true, role: true },
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const items = rows.map((i) => {
        const c = byId.get(i.candidateId);
        return {
            id: i.id,
            title: c?.name ?? 'Candidate',
            subtitle: `${i.type} · ${new Date(i.scheduledAt).toLocaleString()}`,
            href: `/interviews`,
        };
    });
    const label = mode === 'today' ? 'today' : 'upcoming';
    return withMeta(matched, {
        intent: matched.intent,
        answer: total === 0
            ? mode === 'today'
                ? 'No interviews on the calendar for today in your access.'
                : 'No upcoming interviews on your calendar from here.'
            : `You've got **${total}** ${label} interview${total === 1 ? '' : 's'}:`,
        links: [
            {
                label: 'Interviews',
                href: mode === 'today' ? '/interviews?filter=today' : '/interviews?filter=upcoming',
            },
        ],
        items,
    });
}
async function offersPending(auth, matched) {
    const step = matched.offerStep ?? 'all';
    if (!roleMatchesAllowed(auth.role, OFFER_VIEW_ROLES)) {
        return withMeta(matched, {
            intent: matched.intent,
            answer: "Your role can't view offers, so I can't pull that for you.",
            links: [{ label: 'Dashboard', href: '/' }],
        });
    }
    const scope = await buildOfferListWhere(auth);
    let statusFilter;
    let label = 'pending approval';
    if (step === 'exec') {
        statusFilter = 'PENDING_EXEC_APPROVAL';
        label = 'pending executive approval';
    }
    else if (step === 'chain') {
        statusFilter = 'PENDING_APPROVAL';
        label = 'pending chain approval';
    }
    else if (step === 'hr') {
        statusFilter = { in: ['PENDING_HR_APPROVAL', 'PENDING_APPROVAL'] };
        label = 'pending HR / approval';
    }
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
        select: { id: true, status: true, candidateId: true, annualCtc: true },
    });
    const candidateIds = [...new Set(rows.map((o) => o.candidateId))];
    const candidates = await prisma.candidate.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, name: true },
    });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const items = rows.map((o) => ({
        id: o.id,
        title: byId.get(o.candidateId)?.name ?? 'Candidate',
        subtitle: o.status.replace(/_/g, ' '),
        href: `/offers/${o.id}`,
    }));
    return withMeta(matched, {
        intent: matched.intent,
        answer: total === 0
            ? `Nothing ${label} in your offer queue.`
            : `I found **${total}** offer${total === 1 ? '' : 's'} ${label}:`,
        links: [{ label: 'Offers', href: '/offers' }],
        items,
    });
}
async function countPortalUsers(auth, matched) {
    if (!isAdminRole(auth.role)) {
        return withMeta(matched, {
            intent: matched.intent,
            answer: "Portal user totals are for admins only. I can still help with candidates, roles, interviews, and offers in your access.",
            links: [{ label: 'Dashboard', href: '/' }],
            followUps: [
                'Give me a quick overview',
                'How many candidates in interview?',
                'Help',
            ],
        });
    }
    const roleFilter = matched.userRoleFilter;
    if (roleFilter) {
        const [total, active] = await Promise.all([
            prisma.user.count({ where: { role: roleFilter } }),
            prisma.user.count({ where: { role: roleFilter, status: 'ACTIVE' } }),
        ]);
        const label = formatRoleLabel(roleFilter);
        return withMeta(matched, {
            intent: matched.intent,
            answer: total === 0
                ? `There are no **${label}** accounts on the portal.`
                : `There ${total === 1 ? 'is' : 'are'} **${total}** **${label}** account${total === 1 ? '' : 's'} (**${active}** active).`,
            links: [{ label: 'User management', href: '/admin/users' }],
        });
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
    const topRoles = byRole
        .slice(0, 8)
        .map((r) => `• **${formatRoleLabel(r.role)}**: ${r._count._all}`)
        .join('\n');
    const inactive = total - active;
    const answer = total === 0
        ? 'There are no users on the portal yet.'
        : `There ${total === 1 ? 'is' : 'are'} **${total}** user${total === 1 ? '' : 's'} on the portal (**${active}** active${inactive > 0 ? `, **${inactive}** inactive` : ''}).\n\nBy role:\n${topRoles}`;
    return withMeta(matched, {
        intent: matched.intent,
        answer,
        links: [{ label: 'User management', href: '/admin/users' }],
    });
}
async function countVendors(auth, matched) {
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
    return withMeta(matched, {
        intent: matched.intent,
        answer: total === 0
            ? 'No vendors in your access scope.'
            : `There ${total === 1 ? 'is' : 'are'} **${total}** vendor${total === 1 ? '' : 's'} you can see (**${active}** active):`,
        links: [{ label: 'Vendors', href: '/vendors' }],
        items,
    });
}
async function changeRequestsPending(auth, matched) {
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
        href: `/change-requests/${r.id}`,
    }));
    return withMeta(matched, {
        intent: matched.intent,
        answer: total === 0
            ? 'No open change requests in your queue.'
            : `There ${total === 1 ? 'is' : 'are'} **${total}** open change request${total === 1 ? '' : 's'}:`,
        links: [{ label: 'Change requests', href: '/change-requests' }],
        items,
    });
}
async function searchEntity(auth, matched, fallbackQuestion) {
    const q = (matched.searchQuery ?? fallbackQuestion).trim();
    if (q.length < 2) {
        return withMeta(matched, {
            intent: matched.intent,
            answer: 'Give me at least 2 characters to search with.',
            links: [],
        });
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
                select: { id: true, name: true, email: true, status: true, role: true },
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
    if (items.length === 0) {
        return withMeta(matched, {
            intent: matched.intent,
            answer: `I couldn't find anything for “${q}” in your access. Try another name or job code?`,
            links: [{ label: 'Dashboard', href: '/' }],
        });
    }
    return withMeta(matched, {
        intent: matched.intent,
        answer: `Here's what I found for “${q}”:`,
        links: [],
        items,
    });
}
export async function runAssistantQuestion(auth, question, context) {
    const matched = matchAssistantIntent(question, context);
    switch (matched.intent) {
        case 'greeting':
            return greetingAnswer(matched);
        case 'help':
            return helpAnswer(matched);
        case 'out_of_scope':
            return outOfScopeAnswer(matched);
        case 'ops_summary':
            return opsSummary(auth, matched);
        case 'count_candidates_by_status':
            return countCandidatesByStatus(auth, matched);
        case 'list_candidates_by_status':
            return listCandidatesByStatus(auth, matched);
        case 'count_open_requirements':
            return countOpenRequirements(auth, matched);
        case 'list_live_requirements':
            return listLiveRequirements(auth, matched);
        case 'pending_requirements':
            return pendingRequirements(auth, matched);
        case 'interviews_awaiting_feedback':
            return interviewsAwaitingFeedback(auth, matched);
        case 'interviews_upcoming':
            return interviewsInWindow(auth, matched, 'upcoming');
        case 'interviews_today':
            return interviewsInWindow(auth, matched, 'today');
        case 'offers_pending':
            return offersPending(auth, matched);
        case 'count_portal_users':
            return countPortalUsers(auth, matched);
        case 'count_vendors':
            return countVendors(auth, matched);
        case 'change_requests_pending':
            return changeRequestsPending(auth, matched);
        case 'search_entity':
            return searchEntity(auth, matched, question);
        case 'unknown':
        default:
            return withMeta(matched, {
                intent: 'unknown',
                answer: "I couldn't map that to ATS data. I'm strongest on live counts and lists — candidates, jobs, interviews, offers, vendors, change requests, and portal users (admins).\n\nTry “give me a quick overview”, or pick a follow-up:",
                links: [
                    { label: 'Dashboard', href: '/' },
                    { label: 'Candidates', href: '/candidates' },
                    { label: 'Interviews', href: '/interviews' },
                ],
                followUps: [...ASSISTANT_EXAMPLE_QUESTIONS.slice(0, 5)],
            });
    }
}
