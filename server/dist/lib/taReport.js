import { prisma } from './prisma.js';
import { hasTaReportOrgWideAccess } from './orgAccess.js';
import { parseRecruiterIds } from './requirementAccess.js';
import { avg, computeRequirementAgeSnapshot, } from './reportCommon.js';
import { offerCtcToAnnualInr, parseCtcStringToAnnualInr } from './ctcNormalize.js';
const CANDIDATE_METRIC_KEYS = [
    'submissions',
    'toBeScreened',
    'interviews',
    'l1Interview',
    'l2Interview',
    'clientInterview',
    'hrInterview',
    'selections',
    'offers',
    'onboardings',
    'onboardingNoShow',
    'margin',
    'onboardedCtc',
];
const UNASSIGNED = 'Unassigned';
const METRIC_KEYS = [
    'requirements',
    'totalOpenPositions',
    'openings',
    'ageDays',
    'submissions',
    'toBeScreened',
    'interviews',
    'l1Interview',
    'l2Interview',
    'clientInterview',
    'hrInterview',
    'selections',
    'offers',
    'onboardings',
    'onboardingNoShow',
    'po',
    'margin',
    'onboardedCtc',
    'onboardedMargin',
];
function emptyMetrics() {
    return {
        requirements: 0,
        totalOpenPositions: 0,
        openings: 0,
        ageDays: 0,
        submissions: 0,
        toBeScreened: 0,
        interviews: 0,
        l1Interview: 0,
        l2Interview: 0,
        clientInterview: 0,
        hrInterview: 0,
        selections: 0,
        offers: 0,
        onboardings: 0,
        onboardingNoShow: 0,
        po: 0,
        margin: 0,
        onboardedCtc: 0,
        onboardedMargin: 0,
    };
}
/**
 * Parse a requirement salary / CTC band into an annual INR budget.
 * For ranges like "₹28–38 LPA", uses the upper bound (max budget for the role).
 * Monthly figures (e.g. "₹75,000/month") are annualized.
 */
export function parseRoleBudgetInr(salaryBand) {
    return parseCtcStringToAnnualInr(salaryBand);
}
/** Format an INR annual amount as lakhs for budget formulas (e.g. 20 L). */
export function formatBudgetLpa(inr) {
    const lakh = inr / 100_000;
    if (!Number.isFinite(lakh) || lakh === 0)
        return '0 L';
    const rounded = Math.round(lakh * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded} L` : `${rounded} L`;
}
export function buildBudgetFormula(rateInr, positions) {
    const pos = Math.max(1, positions);
    const total = rateInr * pos;
    return `${formatBudgetLpa(rateInr)} × ${pos} position${pos === 1 ? '' : 's'} = ${formatBudgetLpa(total)}`;
}
// ---- Date range helpers (Asia/Kolkata calendar days) --------------------
// Render/API hosts are typically UTC; TA report periods must match IST business days.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
/** Calendar day key (YYYY-MM-DD) in Asia/Kolkata for an instant. */
function istDayKey(d) {
    const shifted = new Date(d.getTime() + IST_OFFSET_MS);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function startOfIstDay(dayKey) {
    const [y, m, d] = dayKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - IST_OFFSET_MS);
}
function endOfIstDay(dayKey) {
    return new Date(startOfIstDay(dayKey).getTime() + 86_400_000 - 1);
}
function shiftIstDayKey(dayKey, deltaDays) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
    const yy = utc.getUTCFullYear();
    const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(utc.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}
function parseIsoDayKey(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const trimmed = value.trim();
    // Prefer explicit calendar day (from date pickers) over timezone-shifted ISO timestamps.
    const dayOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (dayOnly)
        return `${dayOnly[1]}-${dayOnly[2]}-${dayOnly[3]}`;
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime()))
        return null;
    return istDayKey(d);
}
export function normalizePreset(value) {
    // Legacy aliases from older UI labels
    if (value === 'thisMonth')
        return 'mtd';
    if (value === 'thisYear')
        return 'ytd';
    const presets = ['today', 'week', 'mtd', 'ytd', 'custom'];
    return presets.includes(value) ? value : 'mtd';
}
/** Resolve a preset (plus optional custom from/to ISO days) into concrete IST bounds. */
export function resolveDateRange(preset, fromStr, toStr, now = new Date()) {
    const todayKey = istDayKey(now);
    const [y, month] = todayKey.split('-').map(Number);
    switch (preset) {
        case 'today':
            return { from: startOfIstDay(todayKey), to: endOfIstDay(todayKey) };
        case 'week': {
            // Sunday-start week in IST
            const [yy, mm, dd] = todayKey.split('-').map(Number);
            const dow = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
            const fromKey = shiftIstDayKey(todayKey, -dow);
            const toKey = shiftIstDayKey(fromKey, 6);
            return { from: startOfIstDay(fromKey), to: endOfIstDay(toKey) };
        }
        case 'mtd': {
            const fromKey = `${y}-${String(month).padStart(2, '0')}-01`;
            return { from: startOfIstDay(fromKey), to: endOfIstDay(todayKey) };
        }
        case 'ytd': {
            const fromKey = `${y}-01-01`;
            return { from: startOfIstDay(fromKey), to: endOfIstDay(todayKey) };
        }
        case 'custom': {
            const fromKey = parseIsoDayKey(fromStr);
            const toKey = parseIsoDayKey(toStr) ?? fromKey;
            return {
                from: fromKey ? startOfIstDay(fromKey) : null,
                to: toKey ? endOfIstDay(toKey) : null,
            };
        }
        default:
            return { from: startOfIstDay(todayKey), to: endOfIstDay(todayKey) };
    }
}
function emptyEntryBuckets() {
    return {
        submissions: new Map(),
        toBeScreened: new Map(),
        interviews: new Map(),
        l1Interview: new Map(),
        l2Interview: new Map(),
        clientInterview: new Map(),
        hrInterview: new Map(),
        selections: new Map(),
        offers: new Map(),
        onboardings: new Map(),
        onboardingNoShow: new Map(),
        margin: new Map(),
        onboardedCtc: new Map(),
    };
}
function finalizeNames(buckets) {
    const names = {};
    for (const key of CANDIDATE_METRIC_KEYS) {
        if (buckets[key].size > 0) {
            names[key] = [...buckets[key].values()].sort((a, b) => a.name.localeCompare(b.name));
        }
    }
    return names;
}
function dateValue(date) {
    return date ? date.toISOString() : undefined;
}
/** A candidate counts as a submission once linked to a requirement. */
function isSubmission(c) {
    return !!c.requirementId;
}
/** Pipeline queue: awaiting recruiter screening (includes pre-migration statuses). */
function isToBeScreened(c) {
    return (c.status === 'TO_BE_SCREENED' ||
        c.status === 'SCREENING' ||
        c.status === 'SUBMITTED' ||
        c.status === 'ADDED' ||
        c.status === 'SOURCED' ||
        c.status === 'APPLIED');
}
/** Selections = HR Select + To be Offered. */
const SELECTION_STATUSES = new Set(['HR_INTERVIEW_SELECT', 'TO_BE_OFFERED']);
function isSelection(c) {
    return SELECTION_STATUSES.has(c.status);
}
/** Offers = Offered + Offer Accepted. */
const OFFER_STATUSES = new Set(['OFFERED', 'OFFER_ACCEPTED']);
function isOfferStage(c) {
    return OFFER_STATUSES.has(c.status);
}
/** Onboardings = Joined. */
function isJoined(c) {
    return c.status === 'JOINED';
}
function submissionDate(c) {
    return c.submittedAt ?? c.appliedDate;
}
function noneById() {
    return { id: { in: ['__none__'] } };
}
/**
 * TA Report scopes:
 * - HR Head / HR Manager / Team Lead (TA Lead) / Admin: entire org
 * - Recruiter + groupBy client: assigned requirements only, but full job metrics
 *   (all candidates / interviews / offers on those requirements)
 * - Recruiter + groupBy recruiter: purely individual — own activity only;
 *   teammate pivot rows never appear
 */
async function resolveTaReportScopes(auth, groupBy) {
    if (hasTaReportOrgWideAccess(auth.role)) {
        return {
            reqWhere: {},
            candWhere: {},
            interviewWhere: {},
            offerWhere: {},
            allowedReqIds: null,
        };
    }
    if (auth.role === 'RECRUITER') {
        const assignedRows = await prisma.requirement.findMany({
            select: { id: true, recruiters: true },
        });
        const assignedIds = assignedRows
            .filter((r) => parseRecruiterIds(r.recruiters).includes(auth.userId))
            .map((r) => r.id);
        if (assignedIds.length === 0) {
            return {
                reqWhere: noneById(),
                candWhere: noneById(),
                interviewWhere: noneById(),
                offerWhere: noneById(),
                allowedReqIds: [],
            };
        }
        // Client view: assigned jobs with the full requirement funnel (not personal-only).
        if (groupBy === 'client') {
            return {
                reqWhere: { id: { in: assignedIds } },
                candWhere: { requirementId: { in: assignedIds } },
                interviewWhere: { requirementId: { in: assignedIds } },
                offerWhere: { requirementId: { in: assignedIds } },
                allowedReqIds: assignedIds,
            };
        }
        const ownCandidates = await prisma.candidate.findMany({
            where: {
                createdBy: auth.userId,
                requirementId: { in: assignedIds },
            },
            select: { id: true },
        });
        const candidateIds = ownCandidates.map((c) => c.id);
        // Hydrate names for interviews the recruiter scheduled on teammates' candidates.
        // Those candidates are display-only; metrics still skip non-owned submissions.
        const scheduledInterviews = await prisma.interview.findMany({
            where: {
                scheduledBy: auth.userId,
                status: { not: 'CANCELLED' },
                requirementId: { in: assignedIds },
            },
            select: { candidateId: true },
        });
        const nameOnlyCandidateIds = [
            ...new Set(scheduledInterviews
                .map((i) => i.candidateId)
                .filter((id) => id && !candidateIds.includes(id))),
        ];
        return {
            reqWhere: { id: { in: assignedIds } },
            candWhere: {
                requirementId: { in: assignedIds },
                OR: [
                    { createdBy: auth.userId },
                    ...(nameOnlyCandidateIds.length > 0 ? [{ id: { in: nameOnlyCandidateIds } }] : []),
                ],
            },
            interviewWhere: {
                requirementId: { in: assignedIds },
                scheduledBy: auth.userId,
                status: { not: 'CANCELLED' },
            },
            offerWhere: candidateIds.length > 0
                ? { candidateId: { in: candidateIds }, requirementId: { in: assignedIds } }
                : noneById(),
            allowedReqIds: assignedIds,
        };
    }
    return {
        reqWhere: noneById(),
        candWhere: noneById(),
        interviewWhere: noneById(),
        offerWhere: noneById(),
        allowedReqIds: [],
    };
}
const ALLOWED_REQ_STATUSES = new Set([
    'LIVE',
    'ON_HOLD',
    'PENDING_APPROVAL',
    'DRAFT',
    'CLOSED',
    'CANCELLED',
    'REJECTED',
]);
const MONTH_ALIASES = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
};
/** Canonical quarter key: `Q1 2024`. Handles legacy `Q1_24`, `Q2_26`, `Q1'23`. */
export function normalizeQuarterKey(raw) {
    if (!raw?.trim())
        return null;
    const match = raw.trim().match(/^Q\s*([1-4])[\s_\-'\/]*(\d{2}|\d{4})$/i);
    if (!match)
        return null;
    const quarter = match[1];
    let year = match[2];
    if (year.length === 2)
        year = String(2000 + Number(year));
    return `Q${quarter} ${year}`;
}
/** Canonical month key `01`–`12`. Handles `Jun`, `yyyy-mm`, numeric. */
export function normalizeMonthKey(raw) {
    if (!raw?.trim())
        return null;
    const value = raw.trim();
    if (/^\d{4}-\d{2}$/.test(value))
        return value.slice(5, 7);
    if (/^\d{1,2}$/.test(value)) {
        const n = Number(value);
        if (n >= 1 && n <= 12)
            return String(n).padStart(2, '0');
    }
    return MONTH_ALIASES[value.toLowerCase()] ?? null;
}
function parseStringList(value) {
    const raw = [];
    if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item === 'string')
                raw.push(...item.split(','));
        }
    }
    else if (typeof value === 'string') {
        raw.push(...value.split(','));
    }
    return [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
}
/** Parse `status=LIVE&status=ON_HOLD` or `status=LIVE,ON_HOLD`. */
export function parseRequirementStatuses(value) {
    const out = [];
    const seen = new Set();
    for (const part of parseStringList(value)) {
        const status = part.toUpperCase();
        if (!ALLOWED_REQ_STATUSES.has(status) || seen.has(status))
            continue;
        seen.add(status);
        out.push(status);
    }
    return out;
}
/** Parse quarter filters; normalize to `Q1 2026` (accepts `Q1_26`, `Q1 26`, etc.). */
export function parseQuarterFilters(value) {
    const out = [];
    const seen = new Set();
    for (const part of parseStringList(value)) {
        const key = normalizeQuarterKey(part);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}
/** Parse month filters as `01`–`12` (accepts `Jul`, `2026-07`, `7`). */
export function parseMonthFilters(value) {
    const out = [];
    const seen = new Set();
    for (const part of parseStringList(value)) {
        const key = normalizeMonthKey(part);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}
function matchesReqQuarter(raw, filters) {
    if (filters.length === 0)
        return true;
    const key = normalizeQuarterKey(raw);
    return key != null && filters.includes(key);
}
function matchesReqMonth(raw, filters) {
    if (filters.length === 0)
        return true;
    const key = normalizeMonthKey(raw);
    return key != null && filters.includes(key);
}
function quarterKeyFromDate(date) {
    const month = date.getUTCMonth();
    const year = date.getUTCFullYear();
    if (month >= 3 && month <= 5)
        return `Q1 ${year}`;
    if (month >= 6 && month <= 8)
        return `Q2 ${year}`;
    if (month >= 9 && month <= 11)
        return `Q3 ${year}`;
    return `Q4 ${year - 1}`;
}
function monthKeyFromDate(date) {
    return String(date.getUTCMonth() + 1).padStart(2, '0');
}
/**
 * Parse `ranges=YYYY-MM-DD:YYYY-MM-DD,YYYY-MM-DD:YYYY-MM-DD` into IST day bounds.
 * Used so discontinuous quarter/month selections do not fill the gaps between them.
 */
export function parseReportDayRanges(value) {
    if (typeof value !== 'string' || !value.trim())
        return [];
    const ranges = [];
    for (const part of value.split(',')) {
        const [fromRaw, toRaw] = part.split(':');
        const fromKey = parseIsoDayKey(fromRaw);
        const toKey = parseIsoDayKey(toRaw) ?? fromKey;
        if (!fromKey || !toKey)
            continue;
        ranges.push({ from: startOfIstDay(fromKey), to: endOfIstDay(toKey) });
    }
    return ranges;
}
export async function buildTaReport(auth, opts) {
    const { groupBy, from, to } = opts;
    const ranges = opts.ranges?.length ? opts.ranges : null;
    const statusFilter = opts.statuses && opts.statuses.length > 0 ? new Set(opts.statuses) : null;
    const quarterFilters = opts.quarters ?? [];
    const monthFilters = opts.months ?? [];
    const hasPeriodFieldFilters = quarterFilters.length > 0 || monthFilters.length > 0;
    const inRange = (date) => {
        if (!date)
            return false;
        if (ranges)
            return ranges.some((r) => date >= r.from && date <= r.to);
        if (from && date < from)
            return false;
        if (to && date > to)
            return false;
        return true;
    };
    const matchesPeriodFields = (r) => matchesReqQuarter(r.quarter ?? (r.createdAt ? quarterKeyFromDate(r.createdAt) : null), quarterFilters) &&
        matchesReqMonth(r.reqMonth ?? (r.createdAt ? monthKeyFromDate(r.createdAt) : null), monthFilters);
    const { reqWhere: scopeReqWhere, candWhere, interviewWhere, offerWhere, allowedReqIds } = await resolveTaReportScopes(auth, groupBy);
    /** Recruiter + Recruiter pivot: personal metrics only. Client pivot uses full job funnels. */
    const individualRecruiterId = auth.role === 'RECRUITER' && groupBy === 'recruiter' ? auth.userId : null;
    const reqWhere = statusFilter
        ? { AND: [scopeReqWhere, { status: { in: [...statusFilter] } }] }
        : scopeReqWhere;
    const [rawRequirements, candidates, interviews, planStages, users, offers] = await Promise.all([
        prisma.requirement.findMany({
            where: reqWhere,
            select: {
                id: true,
                client: true,
                title: true,
                jobCode: true,
                department: true,
                openings: true,
                filled: true,
                createdAt: true,
                salaryBand: true,
                status: true,
                quarter: true,
                reqMonth: true,
                recruiters: true,
                closedAt: true,
                liveAt: true,
                onHoldAt: true,
                holdStartDate: true,
                holdEndDate: true,
                hiringDeadline: true,
            },
        }),
        prisma.candidate.findMany({
            where: candWhere,
            select: {
                id: true,
                name: true,
                createdBy: true,
                requirementId: true,
                status: true,
                submittedAt: true,
                appliedDate: true,
                offerDate: true,
                expectedJoiningDate: true,
                joiningDate: true,
                updatedAt: true,
                expectedCTC: true,
            },
        }),
        prisma.interview.findMany({
            where: interviewWhere,
            select: {
                id: true,
                candidateId: true,
                requirementId: true,
                planStageId: true,
                scheduledAt: true,
                createdAt: true,
                scheduledBy: true,
                status: true,
            },
        }),
        prisma.interviewPlanStage.findMany({ select: { id: true, order: true, name: true } }),
        prisma.user.findMany({ select: { id: true, name: true } }),
        prisma.offer.findMany({
            where: offerWhere,
            select: {
                id: true,
                candidateId: true,
                requirementId: true,
                annualCtc: true,
                baseSalary: true,
                status: true,
                createdAt: true,
                sentAt: true,
                respondedAt: true,
            },
        }),
    ]);
    // Match Requirements list: quarter / month filters use Requirement.quarter + reqMonth.
    const requirements = rawRequirements.filter((r) => matchesPeriodFields(r));
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    const candById = new Map(candidates.map((c) => [c.id, c]));
    const allowedReqSet = allowedReqIds ? new Set(allowedReqIds) : null;
    // Interviews/offers may reference requirements outside the scoped list (reassigned
    // candidates, deleted access paths). Load those so client grouping + position rows work.
    // Recruiters stay limited to assigned requirements only.
    const missingReqIds = [
        ...new Set([
            ...interviews.map((i) => i.requirementId),
            ...offers.map((o) => o.requirementId),
            ...candidates.map((c) => c.requirementId).filter((id) => !!id),
        ].filter((id) => {
            if (!id || reqById.has(id))
                return false;
            if (allowedReqSet && !allowedReqSet.has(id))
                return false;
            return true;
        })),
    ];
    if (missingReqIds.length > 0) {
        const extraReqs = await prisma.requirement.findMany({
            where: {
                id: { in: missingReqIds },
                ...(statusFilter ? { status: { in: [...statusFilter] } } : {}),
            },
            select: {
                id: true,
                client: true,
                title: true,
                jobCode: true,
                department: true,
                openings: true,
                filled: true,
                createdAt: true,
                salaryBand: true,
                status: true,
                quarter: true,
                reqMonth: true,
                recruiters: true,
                closedAt: true,
                liveAt: true,
                onHoldAt: true,
                holdStartDate: true,
                holdEndDate: true,
                hiringDeadline: true,
            },
        });
        for (const r of extraReqs) {
            if (!matchesPeriodFields(r))
                continue;
            reqById.set(r.id, r);
        }
    }
    /**
     * Activity only counts on requirements that passed status + quarter/month filters.
     * When those filters are set, reqById is already the allowed set.
     */
    const allowReqActivity = (reqId) => {
        if (!reqId)
            return !statusFilter && !hasPeriodFieldFilters;
        return reqById.has(reqId);
    };
    const stageById = new Map(planStages.map((s) => [s.id, s]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    /** Map plan stage → L1 / L2 / Client / HR column (name first, then default orders). */
    const interviewStageBucket = (planStageId) => {
        if (!planStageId)
            return null;
        const stage = stageById.get(planStageId);
        if (!stage)
            return null;
        const name = stage.name.toLowerCase();
        if (name.includes('client'))
            return 'clientInterview';
        if (/\bhr\b/.test(name) || name.includes('hr interview'))
            return 'hrInterview';
        if (/\bl2\b/.test(name) || name.includes('l2 interview') || name.includes('managerial')) {
            return 'l2Interview';
        }
        if (/\bl1\b/.test(name) || name.includes('l1 interview'))
            return 'l1Interview';
        if (stage.order === 0)
            return 'l1Interview';
        if (stage.order === 1)
            return 'l2Interview';
        if (stage.order === 2)
            return 'hrInterview';
        return null;
    };
    const roleBudget = (r) => parseRoleBudgetInr(r.salaryBand) * Math.max(1, r.openings);
    const budgetLineForReq = (r) => {
        const rateInr = parseRoleBudgetInr(r.salaryBand);
        if (!(rateInr > 0))
            return null;
        const positions = Math.max(1, r.openings);
        return {
            label: r.title,
            rateInr,
            positions,
            totalInr: rateInr * positions,
            formula: buildBudgetFormula(rateInr, positions),
        };
    };
    const now = new Date();
    const rows = new Map();
    const nameBuckets = new Map();
    const positionsByRow = new Map();
    const positionNameBuckets = new Map();
    /** Per-row requirement budget formulas (keyed by requirement id). */
    const poBreakdownByRow = new Map();
    const positionBucketKey = (rowKey, reqId) => `${rowKey}::${reqId}`;
    const emptyAging = () => ({
        _ageSum: 0,
        _ageCount: 0,
        _agingApplied: new Set(),
    });
    const addPoBreakdown = (rowKey, r) => {
        const line = budgetLineForReq(r);
        if (!line)
            return;
        let map = poBreakdownByRow.get(rowKey);
        if (!map) {
            map = new Map();
            poBreakdownByRow.set(rowKey, map);
        }
        if (!map.has(r.id))
            map.set(r.id, line);
    };
    const getRow = (key, label) => {
        let row = rows.get(key);
        if (!row) {
            row = { key, label, ...emptyMetrics(), ...emptyAging() };
            rows.set(key, row);
            nameBuckets.set(key, emptyEntryBuckets());
            positionsByRow.set(key, new Map());
        }
        else if (row.label === UNASSIGNED && label !== UNASSIGNED) {
            row.label = label;
        }
        return row;
    };
    const applyAging = (target, r) => {
        if (target._agingApplied.has(r.id))
            return;
        target._agingApplied.add(r.id);
        const age = computeRequirementAgeSnapshot(r, now);
        target._ageSum += age.totalAgeDays;
        target._ageCount += 1;
        // Position rows keep the job’s own age; group rows average in finalizeAging.
        target.ageDays = age.totalAgeDays;
    };
    const finalizeAging = (m) => {
        m.ageDays = avg(m._ageSum, m._ageCount);
    };
    const stripAging = (m) => {
        const { _ageSum, _ageCount, _agingApplied, ...rest } = m;
        void _ageSum;
        void _ageCount;
        void _agingApplied;
        return rest;
    };
    /**
     * Ensure a position row exists for pipeline metrics.
     * Stock fields (openings / age / budget) are applied only via `applyStockMetrics`.
     */
    const getPosition = (rowKey, rowLabel, reqId) => {
        if (!reqId)
            return null;
        const r = reqById.get(reqId);
        if (!r)
            return null;
        getRow(rowKey, rowLabel);
        const map = positionsByRow.get(rowKey);
        let pos = map.get(reqId);
        if (!pos) {
            pos = {
                id: r.id,
                title: r.title,
                jobCode: r.jobCode ?? undefined,
                department: r.department ?? undefined,
                ...emptyMetrics(),
                ...emptyAging(),
                onboardedMargin: 0,
            };
            map.set(reqId, pos);
            positionNameBuckets.set(positionBucketKey(rowKey, reqId), emptyEntryBuckets());
        }
        return pos;
    };
    /** Count requirement openings / age / budget once per group + position. */
    const applyStockMetrics = (rowKey, rowLabel, r) => {
        const row = getRow(rowKey, rowLabel);
        const pos = getPosition(rowKey, rowLabel, r.id);
        if (pos.requirements === 0) {
            pos.requirements = 1;
            pos.totalOpenPositions = Math.max(0, r.openings);
            pos.openings = Math.max(0, r.openings - r.filled);
            pos.po = roleBudget(r);
            row.requirements += 1;
            row.totalOpenPositions += Math.max(0, r.openings);
            row.openings += Math.max(0, r.openings - r.filled);
            row.po += roleBudget(r);
            addPoBreakdown(rowKey, r);
            applyAging(row, r);
            applyAging(pos, r);
        }
        return pos;
    };
    const addName = (rowKey, metric, name, date, reqId, 
    /** Unique key when one person can appear more than once (e.g. multiple interviews). */
    entryKey) => {
        const trimmed = name?.trim();
        if (!trimmed)
            return;
        const entry = { name: trimmed, date: dateValue(date) };
        const mapKey = entryKey ?? trimmed;
        nameBuckets.get(rowKey)?.[metric].set(mapKey, entry);
        if (reqId) {
            positionNameBuckets.get(positionBucketKey(rowKey, reqId))?.[metric].set(mapKey, entry);
        }
    };
    const clientGroupFromReqId = (reqId) => {
        const client = reqId ? reqById.get(reqId)?.client : null;
        const label = client && client.trim() ? client.trim() : UNASSIGNED;
        return { key: `client:${label}`, label };
    };
    const recruiterGroup = (createdBy) => {
        if (!createdBy)
            return { key: 'recruiter:__none__', label: UNASSIGNED };
        const name = userName.get(createdBy);
        return { key: `recruiter:${createdBy}`, label: name && name.trim() ? name : 'Unknown recruiter' };
    };
    const candidateGroup = (c) => {
        if (groupBy === 'recruiter') {
            return recruiterGroup(individualRecruiterId ?? c.createdBy);
        }
        return clientGroupFromReqId(c.requirementId);
    };
    // Stock (openings / age / budget):
    // - With quarter/month filters: all matching tagged requirements (same as Requirements list)
    // - Without: jobs whose live/created date falls in the selected date range
    if (groupBy === 'client') {
        for (const r of requirements) {
            if (!hasPeriodFieldFilters) {
                const anchor = r.liveAt ?? r.createdAt;
                if (!inRange(anchor))
                    continue;
            }
            const g = clientGroupFromReqId(r.id);
            applyStockMetrics(g.key, g.label, r);
        }
    }
    else if (hasPeriodFieldFilters) {
        // Quarter/month open-book: attribute each matching job to its assigned recruiters.
        // Recruiters only get their own stock row (never co-assignees).
        for (const r of requirements) {
            const ids = parseRecruiterIds(r.recruiters);
            const stockIds = individualRecruiterId
                ? ids.includes(individualRecruiterId)
                    ? [individualRecruiterId]
                    : []
                : ids;
            if (stockIds.length === 0) {
                if (!individualRecruiterId)
                    applyStockMetrics('recruiter:__none__', UNASSIGNED, r);
                continue;
            }
            for (const userId of stockIds) {
                const g = recruiterGroup(userId);
                applyStockMetrics(g.key, g.label, r);
            }
        }
    }
    else {
        // Recruiter mode without quarter/month: attribute via in-period submissions.
        const reqSetByGroup = new Map();
        for (const c of candidates) {
            if (!c.requirementId || !allowReqActivity(c.requirementId))
                continue;
            if (individualRecruiterId && c.createdBy !== individualRecruiterId)
                continue;
            if (!isSubmission(c) || !inRange(submissionDate(c)))
                continue;
            const g = recruiterGroup(individualRecruiterId ?? c.createdBy);
            let entry = reqSetByGroup.get(g.key);
            if (!entry) {
                entry = { label: g.label, set: new Set() };
                reqSetByGroup.set(g.key, entry);
            }
            entry.set.add(c.requirementId);
        }
        for (const [key, { label, set }] of reqSetByGroup) {
            for (const reqId of set) {
                const r = reqById.get(reqId);
                if (!r)
                    continue;
                applyStockMetrics(key, label, r);
            }
        }
    }
    // Candidate-derived metrics: submissions, to-be-screened, selections, offers, onboardings
    for (const c of candidates) {
        if (!allowReqActivity(c.requirementId))
            continue;
        // Name-only teammates (hydrated for interview labels) must not inflate metrics.
        if (individualRecruiterId && c.createdBy !== individualRecruiterId)
            continue;
        const g = candidateGroup(c);
        const pos = getPosition(g.key, g.label, c.requirementId);
        const row = getRow(g.key, g.label);
        if (isSubmission(c) && inRange(submissionDate(c))) {
            row.submissions += 1;
            if (pos)
                pos.submissions += 1;
            addName(g.key, 'submissions', c.name, submissionDate(c), c.requirementId);
        }
        if (isSubmission(c) && isToBeScreened(c) && inRange(submissionDate(c))) {
            row.toBeScreened += 1;
            if (pos)
                pos.toBeScreened += 1;
            addName(g.key, 'toBeScreened', c.name, submissionDate(c), c.requirementId);
        }
        // Selections = HR Interview Select + To be Offered
        if (isSelection(c) && inRange(c.updatedAt)) {
            row.selections += 1;
            if (pos)
                pos.selections += 1;
            addName(g.key, 'selections', c.name, c.updatedAt, c.requirementId);
        }
        // Offers = Offered + Offer Accepted
        if (isOfferStage(c) && inRange(c.updatedAt)) {
            row.offers += 1;
            if (pos)
                pos.offers += 1;
            addName(g.key, 'offers', c.name, c.updatedAt, c.requirementId);
        }
        // Onboardings = Joined
        if (isJoined(c)) {
            const joinAt = c.joiningDate ?? c.updatedAt;
            if (inRange(joinAt)) {
                row.onboardings += 1;
                if (pos)
                    pos.onboardings += 1;
                addName(g.key, 'onboardings', c.name, joinAt, c.requirementId);
            }
        }
        // Onboarding no-show: expected DOJ in period but never joined, or declined after offer.
        if (!isJoined(c) &&
            c.expectedJoiningDate &&
            inRange(c.expectedJoiningDate) &&
            c.expectedJoiningDate.getTime() < Date.now() &&
            (c.status === 'OFFERED' || c.status === 'OFFER_ACCEPTED' || c.status === 'TO_BE_OFFERED')) {
            row.onboardingNoShow += 1;
            if (pos)
                pos.onboardingNoShow += 1;
            addName(g.key, 'onboardingNoShow', c.name, c.expectedJoiningDate, c.requirementId);
        }
        else if (c.status === 'OFFER_DECLINED' && inRange(c.updatedAt)) {
            row.onboardingNoShow += 1;
            if (pos)
                pos.onboardingNoShow += 1;
            addName(g.key, 'onboardingNoShow', c.name, c.updatedAt, c.requirementId);
        }
    }
    // Interview-derived metrics: total + L1 / L2 / HR by plan stage.
    // Count when the interview happens in-period (scheduledAt) OR was booked in-period
    // (createdAt) so upcoming slots scheduled this month still show up.
    for (const i of interviews) {
        if (i.status === 'CANCELLED')
            continue;
        if (!inRange(i.scheduledAt) && !inRange(i.createdAt))
            continue;
        const cand = candById.get(i.candidateId);
        const reqId = i.requirementId || cand?.requirementId || null;
        if (!allowReqActivity(reqId))
            continue;
        const g = groupBy === 'recruiter'
            ? recruiterGroup(individualRecruiterId ?? i.scheduledBy ?? cand?.createdBy ?? null)
            : clientGroupFromReqId(reqId);
        const row = getRow(g.key, g.label);
        const pos = getPosition(g.key, g.label, reqId);
        const eventDate = inRange(i.scheduledAt) ? i.scheduledAt : i.createdAt;
        row.interviews += 1;
        if (pos)
            pos.interviews += 1;
        addName(g.key, 'interviews', cand?.name, eventDate, reqId, `interview:${i.id}`);
        const stageKey = interviewStageBucket(i.planStageId);
        if (stageKey) {
            row[stageKey] += 1;
            if (pos)
                pos[stageKey] += 1;
            addName(g.key, stageKey, cand?.name, eventDate, reqId, `interview:${i.id}:${stageKey}`);
        }
    }
    // Offered CTC + Onboarded CTC from offer records (normalized to annual INR).
    // When quarter/month field filters are active, commercials follow the matching
    // requirements (same open-book set) — not the calendar date of offer/join —
    // so CTC still appears for those tagged jobs.
    for (const o of offers) {
        if (o.status === 'CANCELLED' || o.status === 'DECLINED' || o.status === 'REJECTED')
            continue;
        if (!allowReqActivity(o.requirementId))
            continue;
        const cand = candById.get(o.candidateId);
        const fromOffer = offerCtcToAnnualInr(o);
        const fromCandidate = cand?.expectedCTC
            ? parseCtcStringToAnnualInr(cand.expectedCTC)
            : 0;
        const ctc = fromOffer > 0 ? fromOffer : fromCandidate;
        if (!(ctc > 0))
            continue;
        const g = groupBy === 'recruiter'
            ? recruiterGroup(individualRecruiterId ?? cand?.createdBy ?? null)
            : clientGroupFromReqId(o.requirementId);
        const row = getRow(g.key, g.label);
        const pos = getPosition(g.key, g.label, o.requirementId);
        const offerDate = o.respondedAt ?? o.sentAt ?? o.createdAt;
        const joinAt = cand?.joiningDate ?? cand?.updatedAt ?? null;
        const dateOk = (date) => hasPeriodFieldFilters ? true : inRange(date);
        // Offered CTC: accepted/sent offers (not limited to already-joined).
        if ((o.status === 'ACCEPTED' || o.status === 'SENT') &&
            dateOk(offerDate)) {
            row.margin += ctc;
            if (pos)
                pos.margin += ctc;
            addName(g.key, 'margin', cand?.name, offerDate, o.requirementId);
        }
        // Onboarded CTC: joined candidates only.
        if (cand && isJoined(cand) && dateOk(joinAt)) {
            row.onboardedCtc += ctc;
            if (pos)
                pos.onboardedCtc += ctc;
            addName(g.key, 'onboardedCtc', cand.name, joinAt, o.requirementId);
        }
    }
    // TA Margin = Requirement Budget − Onboarded CTC (only when onboarded CTC exists)
    // Age: position rows keep per-requirement age; group rows become averages.
    for (const row of rows.values()) {
        row.onboardedMargin = row.onboardedCtc > 0 ? row.po - row.onboardedCtc : 0;
        finalizeAging(row);
    }
    for (const map of positionsByRow.values()) {
        for (const pos of map.values()) {
            pos.onboardedMargin = pos.onboardedCtc > 0 ? pos.po - pos.onboardedCtc : 0;
            // Keep the single-job age set in applyAging (do not re-average).
            if (pos._ageCount === 1)
                pos.ageDays = pos._ageSum;
            else
                finalizeAging(pos);
        }
    }
    // Belt-and-suspenders: recruiters never see teammate pivot rows.
    if (individualRecruiterId && groupBy === 'recruiter') {
        const ownKey = `recruiter:${individualRecruiterId}`;
        for (const key of [...rows.keys()]) {
            if (key !== ownKey)
                rows.delete(key);
        }
    }
    let ageSum = 0;
    let ageCount = 0;
    for (const row of rows.values()) {
        ageSum += row._ageSum;
        ageCount += row._ageCount;
    }
    const sortedRows = [...rows.values()]
        .sort((a, b) => {
        if (a.label === UNASSIGNED)
            return 1;
        if (b.label === UNASSIGNED)
            return -1;
        return a.label.localeCompare(b.label);
    })
        .map((row) => {
        const breakdown = [...(poBreakdownByRow.get(row.key)?.values() ?? [])].sort((a, b) => a.label.localeCompare(b.label));
        const positions = [...(positionsByRow.get(row.key)?.values() ?? [])]
            .map((pos) => {
            const req = reqById.get(pos.id);
            const line = req ? budgetLineForReq(req) : null;
            const cleaned = stripAging(pos);
            return {
                ...cleaned,
                names: finalizeNames(positionNameBuckets.get(positionBucketKey(row.key, pos.id)) ?? emptyEntryBuckets()),
                poBreakdown: line ? [line] : [],
            };
        })
            .sort((a, b) => a.title.localeCompare(b.title));
        const cleanedRow = stripAging(row);
        return {
            ...cleanedRow,
            names: finalizeNames(nameBuckets.get(row.key) ?? emptyEntryBuckets()),
            poBreakdown: breakdown,
            positions,
        };
    });
    const totalBuckets = emptyEntryBuckets();
    const totalPoBreakdown = [];
    const total = {
        label: 'Total',
        ...emptyMetrics(),
        names: {},
        poBreakdown: [],
    };
    for (const row of sortedRows) {
        for (const key of METRIC_KEYS) {
            if (key === 'onboardedMargin' || key === 'ageDays')
                continue;
            total[key] += row[key];
        }
        for (const key of CANDIDATE_METRIC_KEYS) {
            for (const [idx, entry] of (row.names[key] ?? []).entries()) {
                totalBuckets[key].set(`${row.key}:${entry.name}:${entry.date ?? ''}:${idx}`, entry);
            }
        }
        totalPoBreakdown.push(...row.poBreakdown);
    }
    total.onboardedMargin = total.onboardedCtc > 0 ? total.po - total.onboardedCtc : 0;
    total.ageDays = avg(ageSum, ageCount);
    total.names = finalizeNames(totalBuckets);
    total.poBreakdown = totalPoBreakdown.sort((a, b) => a.label.localeCompare(b.label));
    return { rows: sortedRows, total };
}
