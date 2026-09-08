const STATUS_ALIASES = [
    {
        status: 'L1_INTERVIEW',
        patterns: [/\binterview(?:s|ing)?\b/, /\bin interview\b/, /\bl1\b/],
    },
    {
        status: 'TO_BE_SCREENED',
        patterns: [/\bscreening\b/, /\bscreen(?:ed|s)?\b/, /\bto be screened\b/],
    },
    {
        status: 'SCREEN_SELECT',
        patterns: [/\bshortlist(?:ed|ing)?\b/, /\bscreen select\b/],
    },
    {
        status: 'TO_BE_OFFERED',
        patterns: [/\boffer stage\b/, /\bin offer\b/, /\bto be offered\b/, /\bcandidates? (?:with |on )?offers?\b/],
    },
    {
        status: 'JOINED',
        patterns: [/\bhired\b/, /\bjoined\b/, /\bhires?\b/],
    },
    {
        status: 'TO_BE_SCREENED',
        patterns: [/\bsubmitted\b/, /\bnew (?:applications?|candidates?)\b/],
    },
    {
        status: 'SCREEN_REJECT',
        patterns: [/\brejected\b/, /\bscreen reject\b/],
    },
    {
        status: 'ON_HOLD',
        patterns: [/\bon hold\b/],
    },
];
const USER_ROLE_ALIASES = [
    { role: 'RECRUITER', patterns: [/\brecruiters?\b/] },
    { role: 'INTERVIEWER', patterns: [/\binterviewers?\b/] },
    { role: 'HR_MANAGER', patterns: [/\bhr managers?\b/] },
    { role: 'HR_HEAD', patterns: [/\bhr heads?\b/] },
    { role: 'ADMIN', patterns: [/\badmins?\b/] },
    { role: 'SUPER_ADMIN', patterns: [/\bsuper admins?\b/] },
    { role: 'VENDOR', patterns: [/\bvendors?\b.*\b(users?|accounts?)\b/, /\bvendor (users?|accounts?)\b/] },
    { role: 'HIRING_MANAGER', patterns: [/\bhiring managers?\b/] },
    { role: 'TEAM_LEAD', patterns: [/\bteam leads?\b/] },
    { role: 'FINANCE_HEAD', patterns: [/\bfinance\b/] },
    { role: 'CANDIDATE', patterns: [/\bcandidate (users?|accounts?)\b/] },
    { role: 'EMPLOYEE', patterns: [/\bemployees?\b/] },
];
function normalize(question) {
    return question
        .toLowerCase()
        .replace(/[^\w\s?/'-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function extractSearchQuery(q) {
    const patterns = [
        /(?:find|search|look up|locate|show(?: me)?)\s+(?:candidate|requirement|user|person)?\s*(.+)$/i,
        /(?:who is|who's)\s+(.+)$/i,
    ];
    for (const re of patterns) {
        const m = q.match(re);
        if (m?.[1]) {
            const cleaned = m[1]
                .replace(/\b(candidate|requirement|user|profile|named?)\b/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleaned.length >= 2)
                return cleaned;
        }
    }
    return undefined;
}
function isListFollowUp(q) {
    return (/^(list|show|see)\s+(them|those|these|it)?\s*$/.test(q) ||
        /^(list|show)\s+(me\s+)?(them|those|these)\b/.test(q) ||
        /\b(list|show|who are|which ones?)\b/.test(q) ||
        /^(yes|yeah|yep|please|sure|ok|okay)\b/.test(q) ||
        /\b(can you )?(list|show) (them|those)\b/.test(q));
}
function resolveFollowUp(q, context) {
    if (!context?.lastIntent)
        return null;
    if (isListFollowUp(q) &&
        (context.lastIntent === 'count_candidates_by_status' ||
            context.lastIntent === 'list_candidates_by_status')) {
        return {
            intent: 'list_candidates_by_status',
            candidateStatus: context.candidateStatus ?? 'ALL',
        };
    }
    if (isListFollowUp(q) &&
        (context.lastIntent === 'count_open_requirements' ||
            context.lastIntent === 'list_live_requirements' ||
            context.lastIntent === 'pending_requirements')) {
        return {
            intent: context.lastIntent === 'pending_requirements'
                ? 'pending_requirements'
                : 'list_live_requirements',
        };
    }
    if (isListFollowUp(q) &&
        (context.lastIntent === 'interviews_awaiting_feedback' ||
            context.lastIntent === 'interviews_upcoming' ||
            context.lastIntent === 'interviews_today' ||
            context.lastIntent === 'offers_pending' ||
            context.lastIntent === 'count_vendors' ||
            context.lastIntent === 'change_requests_pending')) {
        return {
            intent: context.lastIntent,
            offerStep: context.offerStep,
            candidateStatus: context.candidateStatus,
        };
    }
    if (/^(and |what about |how about |also )/.test(q) ||
        /^(offers?|feedback|interviews?|requirements?|users?|vendors?|change requests?)\??$/.test(q)) {
        if (/\bfeedback\b/.test(q))
            return { intent: 'interviews_awaiting_feedback' };
        if (/\btoday\b/.test(q))
            return { intent: 'interviews_today' };
        if (/\bupcoming\b/.test(q) || /\bscheduled\b/.test(q))
            return { intent: 'interviews_upcoming' };
        if (/\boffer/.test(q)) {
            let offerStep = 'all';
            if (/\bhr\b/.test(q))
                offerStep = 'hr';
            else if (/\bexec/.test(q))
                offerStep = 'exec';
            return { intent: 'offers_pending', offerStep };
        }
        if (/\busers?\b/.test(q))
            return { intent: 'count_portal_users' };
        if (/\bvendors?\b/.test(q))
            return { intent: 'count_vendors' };
        if (/\bchange request/.test(q))
            return { intent: 'change_requests_pending' };
        if (/\brequirement|\broles?|\bjobs?\b/.test(q))
            return { intent: 'list_live_requirements' };
        if (/\binterview/.test(q))
            return { intent: 'interviews_upcoming' };
    }
    return null;
}
function matchOutOfScope(q) {
    if (/\b(recruitment|hiring|hr|company|leave|attendance|expense|travel)\b.*\bpolic(?:y|ies)\b/.test(q) ||
        /\bpolic(?:y|ies)\b/.test(q) ||
        /\b(handbook|sop|standard operating|guidelines?|code of conduct)\b/.test(q) ||
        /\b(payroll|appraisal|performance review|okrs?)\b/.test(q) ||
        /\b(how (do|does|should) (we|i|the) (hire|recruit|onboard))\b/.test(q)) {
        let topic = 'company policy / process docs';
        if (/\bpolic(?:y|ies)\b/.test(q))
            topic = 'policies';
        else if (/\bhandbook\b/.test(q))
            topic = 'handbooks';
        else if (/\bsop\b|\bstandard operating\b/.test(q))
            topic = 'SOPs';
        return { intent: 'out_of_scope', outOfScopeTopic: topic };
    }
    return null;
}
function extractUserRoleFilter(q) {
    for (const row of USER_ROLE_ALIASES) {
        if (row.patterns.some((p) => p.test(q)))
            return row.role;
    }
    return undefined;
}
export function matchAssistantIntent(question, context) {
    const q = normalize(question);
    if (!q)
        return { intent: 'help' };
    const followUp = resolveFollowUp(q, context);
    if (followUp)
        return followUp;
    if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(q)) {
        return { intent: 'greeting' };
    }
    if (/^(help)\b/.test(q) ||
        /\bwhat can you (do|answer|help)\b/.test(q) ||
        /\b(examples?|capabilities)\b/.test(q) ||
        /\bhow (do|can) i use\b/.test(q) ||
        /\bwhat (questions?|things?) can\b/.test(q)) {
        return { intent: 'help' };
    }
    const outOfScope = matchOutOfScope(q);
    if (outOfScope)
        return outOfScope;
    if (/\b(overview|summary|snapshot|dashboard)\b/.test(q) ||
        /\bwhat('?s| is) (going on|the status|my status|happening)\b/.test(q) ||
        /\bwhere (do|are) (we|things) (stand|at)\b/.test(q) ||
        /^(status|update|numbers)\??$/.test(q)) {
        return { intent: 'ops_summary' };
    }
    // Portal / staff accounts
    if ((/\b(how many|count|number of)\b/.test(q) &&
        /\b(users?|accounts?|logins?)\b/.test(q) &&
        !/\bcandidates?\b/.test(q)) ||
        /\busers?\b.*\b(on (the )?portal|in (the )?system|registered)\b/.test(q) ||
        /\b(portal|system)\b.*\busers?\b/.test(q) ||
        /\bhow many (people|staff)\b.*\b(access|accounts?|portal|system)\b/.test(q) ||
        (/\b(how many|count|number of)\b/.test(q) && extractUserRoleFilter(q) && !/\bcandidates?\b/.test(q))) {
        return {
            intent: 'count_portal_users',
            userRoleFilter: extractUserRoleFilter(q),
        };
    }
    if (/\b(how many|count|number of|list|show|any)\b.*\bvendors?\b/.test(q) ||
        /\bvendors?\b.*\b(active|registered|onboarded)\b/.test(q) ||
        /\bactive vendors?\b/.test(q)) {
        return { intent: 'count_vendors' };
    }
    if (/\bchange requests?\b/.test(q) ||
        /\b(pending|open|awaiting)\b.*\b(change|cr)\b/.test(q) ||
        /\b(requests?|tickets?)\b.*\b(pending|open|awaiting)\b.*\b(hr|admin)\b/.test(q)) {
        return { intent: 'change_requests_pending' };
    }
    if (/\b(awaiting|pending|need(?:s|ed)?|missing)\b.*\bfeedback\b/.test(q) ||
        /\bfeedback\b.*\b(awaiting|pending|queue|needed)\b/.test(q) ||
        /\bmy feedback queue\b/.test(q)) {
        return { intent: 'interviews_awaiting_feedback' };
    }
    if (/\binterview(?:s)?\b.*\btoday\b/.test(q) ||
        /\btoday'?s?\b.*\binterview/.test(q) ||
        /\b(any|how many)\b.*\binterview(?:s)?\b.*\btoday\b/.test(q)) {
        return { intent: 'interviews_today' };
    }
    if (/\b(upcoming|scheduled|tomorrow)\b.*\binterview/.test(q) ||
        /\binterview(?:s)?\b.*\b(upcoming|scheduled|tomorrow)\b/.test(q)) {
        return { intent: 'interviews_upcoming' };
    }
    if (/\boffer/.test(q) && /\b(pending|awaiting|approval|approve)\b/.test(q)) {
        let offerStep = 'all';
        if (/\bexec(utive)?\b/.test(q))
            offerStep = 'exec';
        else if (/\bchain\b/.test(q) || /\bfinance\b/.test(q))
            offerStep = 'chain';
        else if (/\bhr\b/.test(q))
            offerStep = 'hr';
        return { intent: 'offers_pending', offerStep };
    }
    if (/\b(pending|awaiting|need)\b.*\b(approval|approve)\b.*\b(requirement|job|role|req)\b/.test(q) ||
        /\b(requirement|job|role|req)s?\b.*\b(pending|awaiting)\b.*\bapproval\b/.test(q) ||
        /\bpending requirements?\b/.test(q) ||
        /\bjobs? waiting (for )?approval\b/.test(q)) {
        return { intent: 'pending_requirements' };
    }
    if (/\b(live|open|active)\b.*\brequirements?\b/.test(q) ||
        /\brequirements?\b.*\b(live|open|active)\b/.test(q) ||
        /\bhow many\b.*\b(live|open)\b.*\bjobs?\b/.test(q) ||
        /\bopen (?:roles?|jobs?|positions?)\b/.test(q)) {
        if (/\b(list|show|which|what)\b/.test(q)) {
            return { intent: 'list_live_requirements' };
        }
        return { intent: 'count_open_requirements' };
    }
    const wantsList = /\b(list|show|who are|which)\b/.test(q) &&
        !/\bhow many\b/.test(q) &&
        !/\bcount\b/.test(q);
    if ((/\b(how many|count|number of)\b/.test(q) || wantsList) &&
        /\b(candidate|candidates|applications?|applicants?)\b/.test(q)) {
        let status = 'ALL';
        for (const row of STATUS_ALIASES) {
            if (row.patterns.some((p) => p.test(q))) {
                status = row.status;
                break;
            }
        }
        return {
            intent: wantsList ? 'list_candidates_by_status' : 'count_candidates_by_status',
            candidateStatus: status,
        };
    }
    // Status without saying "candidate" — e.g. "how many hired?"
    if ((/\b(how many|count|number of|any|list|show)\b/.test(q) || wantsList) &&
        STATUS_ALIASES.some((r) => r.patterns.some((p) => p.test(q))) &&
        !/\b(interview(?:s)? (today|upcoming|scheduled)|feedback|offer)\b/.test(q)) {
        for (const row of STATUS_ALIASES) {
            if (row.patterns.some((p) => p.test(q))) {
                // "how many interviews" without status context → upcoming, not L1_INTERVIEW status
                if (row.status === 'L1_INTERVIEW' && /\binterview/.test(q) && !/\bcandidate|\bin interview\b/.test(q)) {
                    continue;
                }
                return {
                    intent: wantsList ? 'list_candidates_by_status' : 'count_candidates_by_status',
                    candidateStatus: row.status,
                };
            }
        }
    }
    if (/\bcandidates?\b/.test(q) && STATUS_ALIASES.some((r) => r.patterns.some((p) => p.test(q)))) {
        for (const row of STATUS_ALIASES) {
            if (row.patterns.some((p) => p.test(q))) {
                return {
                    intent: wantsList ? 'list_candidates_by_status' : 'count_candidates_by_status',
                    candidateStatus: row.status,
                };
            }
        }
    }
    // Bare interview questions
    if (/\binterviews?\b/.test(q) && /\b(any|how many|show|list|what)\b/.test(q)) {
        if (/\bfeedback\b/.test(q))
            return { intent: 'interviews_awaiting_feedback' };
        if (/\btoday\b/.test(q))
            return { intent: 'interviews_today' };
        return { intent: 'interviews_upcoming' };
    }
    if (/\boffers?\b/.test(q) && /\b(any|how many|show|list|what)\b/.test(q)) {
        return { intent: 'offers_pending', offerStep: 'all' };
    }
    if (/\brequirements?\b/.test(q) && /\b(any|how many|show|list|what)\b/.test(q)) {
        return { intent: 'list_live_requirements' };
    }
    const searchQuery = extractSearchQuery(question);
    if (searchQuery) {
        return { intent: 'search_entity', searchQuery };
    }
    if (/^[a-z][a-z.'-]+(?:\s+[a-z][a-z.'-]+){0,3}$/.test(q) &&
        q.length >= 2 &&
        !/\b(how|what|show|list|count|any|do|does|is|are|can|should)\b/.test(q)) {
        return { intent: 'search_entity', searchQuery: question.trim() };
    }
    // Soft fallback: treat broad "do we have / is there" as ops summary
    if (/\b(do we have|is there|are there|any)\b/.test(q)) {
        return { intent: 'ops_summary' };
    }
    return { intent: 'unknown' };
}
export const ASSISTANT_EXAMPLE_QUESTIONS = [
    'Give me a quick overview',
    'How many candidates in interview?',
    'Show me open requirements',
    'Any interviews awaiting feedback?',
    'What interviews are today?',
    'Offers pending HR approval',
    'How many users on the portal?',
    'Any pending change requests?',
    'How many vendors?',
    'Find candidate Aisha',
];
export function followUpsForIntent(matched) {
    switch (matched.intent) {
        case 'ops_summary':
            return [
                'How many candidates in interview?',
                'Interviews awaiting feedback',
                'Open requirements',
            ];
        case 'count_candidates_by_status':
            return ['List them', 'How many in screening?', 'Open requirements'];
        case 'list_candidates_by_status':
            return ['How many in interview?', 'Interviews awaiting feedback', 'Offers pending HR'];
        case 'count_open_requirements':
            return ['List them', 'Pending requirement approvals', 'How many candidates in interview?'];
        case 'list_live_requirements':
            return ['Pending requirement approvals', 'How many candidates in interview?'];
        case 'pending_requirements':
            return ['Show open requirements', 'How many candidates in interview?'];
        case 'interviews_awaiting_feedback':
            return ['Interviews today', 'Upcoming interviews'];
        case 'interviews_upcoming':
        case 'interviews_today':
            return ['Interviews awaiting feedback', 'Find a candidate'];
        case 'offers_pending':
            return ['Offers pending exec', 'How many candidates in offer?', 'Open requirements'];
        case 'count_portal_users':
            return ['How many recruiters?', 'How many vendors?', 'Open requirements'];
        case 'count_vendors':
            return ['How many users on the portal?', 'Open requirements'];
        case 'change_requests_pending':
            return ['Give me a quick overview', 'How many users on the portal?'];
        case 'out_of_scope':
            return ['Give me a quick overview', 'How many candidates in interview?', 'Help'];
        case 'search_entity':
            return ['How many candidates in interview?', 'Open requirements'];
        case 'greeting':
        case 'help':
            return [...ASSISTANT_EXAMPLE_QUESTIONS.slice(0, 5)];
        default:
            return ['Give me a quick overview', 'Help', 'How many candidates in interview?'];
    }
}
