import { prisma } from './prisma.js';
import { parseRoleBudgetInr } from './taReport.js';
import { offerCtcToAnnualInr } from './ctcNormalize.js';
import { UNASSIGNED, avg, computeRequirementAgeSnapshot, dateValue, finalizeNameMap, inDateRange, isClosedReq, isJoined, isOfferStage, isOnHoldReq, isSelection, isSubmission, isToBeScreened, pct, submissionDate, } from './reportCommon.js';
const CANDIDATE_KEYS = [
    'submissions',
    'toBeScreened',
    'interviews',
    'selections',
    'offers',
    'joins',
];
const METRIC_KEYS = [
    'jobs',
    'positionsOpened',
    'filled',
    'unfilled',
    'fillRatePct',
    'submissions',
    'toBeScreened',
    'interviews',
    'selections',
    'offers',
    'joins',
    'onHold',
    'closed',
    'ageDays',
    'budget',
    'onboardedCtc',
];
function emptyMetrics() {
    return {
        jobs: 0,
        positionsOpened: 0,
        filled: 0,
        unfilled: 0,
        fillRatePct: 0,
        submissions: 0,
        toBeScreened: 0,
        interviews: 0,
        selections: 0,
        offers: 0,
        joins: 0,
        onHold: 0,
        closed: 0,
        ageDays: 0,
        budget: 0,
        onboardedCtc: 0,
    };
}
function emptyBuckets() {
    return {
        submissions: new Map(),
        toBeScreened: new Map(),
        interviews: new Map(),
        selections: new Map(),
        offers: new Map(),
        joins: new Map(),
    };
}
function finalizeNames(buckets) {
    const names = {};
    for (const key of CANDIDATE_KEYS) {
        if (buckets[key].size > 0)
            names[key] = finalizeNameMap(buckets[key]);
    }
    return names;
}
function groupFromReq(groupBy, r) {
    if (groupBy === 'department') {
        const label = r.department?.trim() || UNASSIGNED;
        return { key: `department:${label}`, label };
    }
    if (groupBy === 'hiringManager') {
        const label = r.hiringManager?.trim() || UNASSIGNED;
        return { key: `hm:${label}`, label };
    }
    if (groupBy === 'accountManager') {
        const label = r.accountManager?.trim() || UNASSIGNED;
        return { key: `am:${label}`, label };
    }
    const label = r.client?.trim() || UNASSIGNED;
    return { key: `client:${label}`, label };
}
export async function buildHiringReport(opts) {
    const { groupBy, from, to } = opts;
    const inRange = (d) => inDateRange(d, from, to);
    const now = new Date();
    const [requirements, candidates, interviews, offers] = await Promise.all([
        prisma.requirement.findMany({
            select: {
                id: true,
                client: true,
                title: true,
                jobCode: true,
                department: true,
                hiringManager: true,
                accountManager: true,
                openings: true,
                filled: true,
                status: true,
                hiringStage: true,
                salaryBand: true,
                createdAt: true,
                closedAt: true,
                liveAt: true,
                onHoldAt: true,
                holdStartDate: true,
                holdEndDate: true,
                hiringDeadline: true,
            },
        }),
        prisma.candidate.findMany({
            select: {
                id: true,
                name: true,
                requirementId: true,
                status: true,
                submittedAt: true,
                appliedDate: true,
                joiningDate: true,
                updatedAt: true,
            },
        }),
        prisma.interview.findMany({
            where: { status: { not: 'CANCELLED' } },
            select: {
                id: true,
                candidateId: true,
                requirementId: true,
                scheduledAt: true,
                createdAt: true,
            },
        }),
        prisma.offer.findMany({
            where: { status: 'ACCEPTED' },
            select: {
                candidateId: true,
                requirementId: true,
                annualCtc: true,
                baseSalary: true,
            },
        }),
    ]);
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    const candById = new Map(candidates.map((c) => [c.id, c]));
    const rows = new Map();
    const nameBuckets = new Map();
    const positionsByRow = new Map();
    const positionNameBuckets = new Map();
    const posKey = (rowKey, reqId) => `${rowKey}::${reqId}`;
    const getRow = (key, label) => {
        let row = rows.get(key);
        if (!row) {
            row = {
                key,
                label,
                ...emptyMetrics(),
                _ageSum: 0,
                _ageCount: 0,
                _agingApplied: new Set(),
            };
            rows.set(key, row);
            nameBuckets.set(key, emptyBuckets());
            positionsByRow.set(key, new Map());
        }
        return row;
    };
    const getPos = (rowKey, rowLabel, reqId) => {
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
                _ageSum: 0,
                _ageCount: 0,
                _agingApplied: new Set(),
            };
            map.set(reqId, pos);
            positionNameBuckets.set(posKey(rowKey, reqId), emptyBuckets());
        }
        return pos;
    };
    const applyAging = (target, r) => {
        if (target._agingApplied.has(r.id))
            return;
        target._agingApplied.add(r.id);
        const age = computeRequirementAgeSnapshot(r, now);
        target._ageSum += age.totalAgeDays;
        target._ageCount += 1;
        // Position rows keep the job’s own age; group rows average in finalizeDerived.
        target.ageDays = age.totalAgeDays;
    };
    const addName = (rowKey, metric, name, date, reqId, entryKey) => {
        const trimmed = name?.trim();
        if (!trimmed)
            return;
        const entry = { name: trimmed, date: dateValue(date) };
        const mapKey = entryKey ?? trimmed;
        nameBuckets.get(rowKey)?.[metric].set(mapKey, entry);
        if (reqId)
            positionNameBuckets.get(posKey(rowKey, reqId))?.[metric].set(mapKey, entry);
    };
    const finalizeDerived = (m, opts) => {
        m.fillRatePct = pct(m.filled, m.positionsOpened);
        if (opts?.keepPositionAge && m._ageCount === 1) {
            m.ageDays = m._ageSum;
        }
        else {
            m.ageDays = avg(m._ageSum, m._ageCount);
        }
    };
    for (const r of requirements) {
        const anchor = r.liveAt ?? r.createdAt;
        if (!inRange(anchor))
            continue;
        const g = groupFromReq(groupBy, r);
        const row = getRow(g.key, g.label);
        const pos = getPos(g.key, g.label, r.id);
        const openings = Math.max(0, r.openings);
        const filled = Math.max(0, r.filled);
        const budget = parseRoleBudgetInr(r.salaryBand) * Math.max(1, openings);
        for (const target of [row, pos]) {
            target.jobs += 1;
            target.positionsOpened += openings;
            target.filled += filled;
            target.unfilled += Math.max(0, openings - filled);
            target.budget += budget;
            if (isOnHoldReq(r.status, r.hiringStage))
                target.onHold += 1;
            if (isClosedReq(r.status))
                target.closed += 1;
            applyAging(target, r);
        }
    }
    for (const c of candidates) {
        if (!isSubmission(c) || !c.requirementId)
            continue;
        const r = reqById.get(c.requirementId);
        if (!r)
            continue;
        const g = groupFromReq(groupBy, r);
        const row = getRow(g.key, g.label);
        const pos = getPos(g.key, g.label, c.requirementId);
        const subAt = submissionDate(c);
        // Ensure ageing is present even when the job only appears via pipeline activity.
        applyAging(row, r);
        if (pos)
            applyAging(pos, r);
        if (inRange(subAt)) {
            row.submissions += 1;
            if (pos)
                pos.submissions += 1;
            addName(g.key, 'submissions', c.name, subAt, c.requirementId);
            if (isToBeScreened(c.status)) {
                row.toBeScreened += 1;
                if (pos)
                    pos.toBeScreened += 1;
                addName(g.key, 'toBeScreened', c.name, subAt, c.requirementId);
            }
        }
        if (isSelection(c.status) && inRange(c.updatedAt)) {
            row.selections += 1;
            if (pos)
                pos.selections += 1;
            addName(g.key, 'selections', c.name, c.updatedAt, c.requirementId);
        }
        if (isOfferStage(c.status) && inRange(c.updatedAt)) {
            row.offers += 1;
            if (pos)
                pos.offers += 1;
            addName(g.key, 'offers', c.name, c.updatedAt, c.requirementId);
        }
        if (isJoined(c.status)) {
            const joinAt = c.joiningDate ?? c.updatedAt;
            if (inRange(joinAt)) {
                row.joins += 1;
                if (pos)
                    pos.joins += 1;
                addName(g.key, 'joins', c.name, joinAt, c.requirementId);
            }
        }
    }
    for (const i of interviews) {
        if (!inRange(i.scheduledAt) && !inRange(i.createdAt))
            continue;
        const cand = candById.get(i.candidateId);
        const reqId = i.requirementId || cand?.requirementId || null;
        if (!reqId)
            continue;
        const r = reqById.get(reqId);
        if (!r)
            continue;
        const g = groupFromReq(groupBy, r);
        const row = getRow(g.key, g.label);
        const pos = getPos(g.key, g.label, reqId);
        applyAging(row, r);
        if (pos)
            applyAging(pos, r);
        const eventDate = inRange(i.scheduledAt) ? i.scheduledAt : i.createdAt;
        row.interviews += 1;
        if (pos)
            pos.interviews += 1;
        addName(g.key, 'interviews', cand?.name, eventDate, reqId, `interview:${i.id}`);
    }
    for (const o of offers) {
        const cand = candById.get(o.candidateId);
        if (!cand || !isJoined(cand.status))
            continue;
        const joinAt = cand.joiningDate ?? cand.updatedAt;
        if (!inRange(joinAt))
            continue;
        const reqId = o.requirementId || cand.requirementId;
        if (!reqId)
            continue;
        const r = reqById.get(reqId);
        if (!r)
            continue;
        const ctc = offerCtcToAnnualInr(o);
        if (!(ctc > 0))
            continue;
        const g = groupFromReq(groupBy, r);
        const row = getRow(g.key, g.label);
        const pos = getPos(g.key, g.label, reqId);
        applyAging(row, r);
        if (pos)
            applyAging(pos, r);
        row.onboardedCtc += ctc;
        if (pos)
            pos.onboardedCtc += ctc;
    }
    for (const row of rows.values())
        finalizeDerived(row);
    for (const map of positionsByRow.values()) {
        for (const pos of map.values())
            finalizeDerived(pos, { keepPositionAge: true });
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
        const { _ageSum: _as, _ageCount: _ac, _agingApplied: _aa, ...rest } = row;
        void _as;
        void _ac;
        void _aa;
        const positions = [...(positionsByRow.get(row.key)?.values() ?? [])]
            .map((pos) => {
            const { _ageSum: __as, _ageCount: __ac, _agingApplied: __aa, ...posRest } = pos;
            void __as;
            void __ac;
            void __aa;
            return {
                ...posRest,
                names: finalizeNames(positionNameBuckets.get(posKey(row.key, pos.id)) ?? emptyBuckets()),
            };
        })
            .sort((a, b) => a.title.localeCompare(b.title));
        return {
            ...rest,
            names: finalizeNames(nameBuckets.get(row.key) ?? emptyBuckets()),
            positions,
        };
    });
    const totalBuckets = emptyBuckets();
    const totalAcc = emptyMetrics();
    for (const row of sortedRows) {
        for (const key of METRIC_KEYS) {
            if (key === 'fillRatePct' || key === 'ageDays')
                continue;
            totalAcc[key] += row[key];
        }
        for (const key of CANDIDATE_KEYS) {
            for (const [idx, entry] of (row.names[key] ?? []).entries()) {
                totalBuckets[key].set(`${row.key}:${entry.name}:${entry.date ?? ''}:${idx}`, entry);
            }
        }
    }
    totalAcc.fillRatePct = pct(totalAcc.filled, totalAcc.positionsOpened);
    totalAcc.ageDays = avg(ageSum, ageCount);
    return {
        rows: sortedRows,
        total: {
            label: 'Total',
            ...totalAcc,
            names: finalizeNames(totalBuckets),
        },
    };
}
