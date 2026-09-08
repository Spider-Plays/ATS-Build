import { prisma } from './prisma.js';
import { offerCtcToAnnualInr } from './ctcNormalize.js';
import { UNASSIGNED, avg, dateValue, finalizeNameMap, inDateRange, isJoined, isOfferStage, isRejected, isSelection, isSubmission, isToBeScreened, pct, submissionDate, } from './reportCommon.js';
const CANDIDATE_KEYS = [
    'profiles',
    'toBeScreened',
    'interviews',
    'selections',
    'offers',
    'joins',
    'rejects',
    'noShow',
];
const METRIC_KEYS = [
    'profiles',
    'assignedJobs',
    'jobsSubmitted',
    'toBeScreened',
    'interviews',
    'selections',
    'offers',
    'joins',
    'rejects',
    'noShow',
    'conversionPct',
    'avgMatchScore',
    'onboardedCtc',
];
function emptyMetrics() {
    return {
        profiles: 0,
        assignedJobs: 0,
        jobsSubmitted: 0,
        toBeScreened: 0,
        interviews: 0,
        selections: 0,
        offers: 0,
        joins: 0,
        rejects: 0,
        noShow: 0,
        conversionPct: 0,
        avgMatchScore: 0,
        onboardedCtc: 0,
    };
}
function emptyBuckets() {
    return {
        profiles: new Map(),
        toBeScreened: new Map(),
        interviews: new Map(),
        selections: new Map(),
        offers: new Map(),
        joins: new Map(),
        rejects: new Map(),
        noShow: new Map(),
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
export async function buildVendorReport(opts) {
    const { groupBy, from, to } = opts;
    const inRange = (d) => inDateRange(d, from, to);
    const now = Date.now();
    const [candidates, requirements, interviews, offers, vendors, vendorReqs] = await Promise.all([
        prisma.candidate.findMany({
            where: { vendorId: { not: null } },
            select: {
                id: true,
                name: true,
                requirementId: true,
                status: true,
                matchScore: true,
                submittedAt: true,
                appliedDate: true,
                joiningDate: true,
                expectedJoiningDate: true,
                updatedAt: true,
                vendorId: true,
            },
        }),
        prisma.requirement.findMany({
            select: {
                id: true,
                client: true,
                title: true,
                jobCode: true,
                department: true,
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
        prisma.vendor.findMany({
            select: { id: true, name: true, code: true, status: true },
        }),
        prisma.vendorRequirement.findMany({
            select: { vendorId: true, requirementId: true },
        }),
    ]);
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    const vendorById = new Map(vendors.map((v) => [v.id, v]));
    const candById = new Map(candidates.map((c) => [c.id, c]));
    const vendorCandIds = new Set(candidates.map((c) => c.id));
    const assignedByVendor = new Map();
    for (const vr of vendorReqs) {
        let set = assignedByVendor.get(vr.vendorId);
        if (!set) {
            set = new Set();
            assignedByVendor.set(vr.vendorId, set);
        }
        set.add(vr.requirementId);
    }
    const rows = new Map();
    const nameBuckets = new Map();
    const positionsByRow = new Map();
    const positionNameBuckets = new Map();
    const posKey = (rowKey, reqId) => `${rowKey}::${reqId}`;
    const groupOf = (c) => {
        if (groupBy === 'client') {
            const client = c.requirementId ? reqById.get(c.requirementId)?.client : null;
            const label = client?.trim() || UNASSIGNED;
            return { key: `client:${label}`, label };
        }
        const vendor = c.vendorId ? vendorById.get(c.vendorId) : null;
        const label = vendor?.name?.trim() || 'Unknown vendor';
        return {
            key: `vendor:${c.vendorId ?? '__none__'}`,
            label,
            subtitle: vendor?.code ?? undefined,
        };
    };
    const getRow = (g) => {
        let row = rows.get(g.key);
        if (!row) {
            row = {
                key: g.key,
                label: g.label,
                subtitle: g.subtitle,
                ...emptyMetrics(),
                _matchSum: 0,
                _matchCount: 0,
                _jobSet: new Set(),
                _assignedSet: new Set(),
            };
            rows.set(g.key, row);
            nameBuckets.set(g.key, emptyBuckets());
            positionsByRow.set(g.key, new Map());
        }
        return row;
    };
    const getPos = (rowKey, reqId) => {
        if (!reqId)
            return null;
        const r = reqById.get(reqId);
        if (!r)
            return null;
        const map = positionsByRow.get(rowKey);
        let pos = map.get(reqId);
        if (!pos) {
            pos = {
                id: r.id,
                title: r.title,
                jobCode: r.jobCode ?? undefined,
                department: r.department ?? undefined,
                ...emptyMetrics(),
                _matchSum: 0,
                _matchCount: 0,
                _jobSet: new Set(),
                _assignedSet: new Set(),
            };
            map.set(reqId, pos);
            positionNameBuckets.set(posKey(rowKey, reqId), emptyBuckets());
        }
        return pos;
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
    const finalizeDerived = (m) => {
        m.jobsSubmitted = m._jobSet.size;
        m.assignedJobs = m._assignedSet.size;
        m.conversionPct = pct(m.joins, m.profiles);
        m.avgMatchScore = avg(m._matchSum, m._matchCount);
    };
    // Seed vendor rows with assigned jobs (vendor grouping only)
    if (groupBy === 'vendor') {
        for (const [vendorId, reqIds] of assignedByVendor) {
            const vendor = vendorById.get(vendorId);
            const g = {
                key: `vendor:${vendorId}`,
                label: vendor?.name?.trim() || 'Unknown vendor',
                subtitle: vendor?.code ?? undefined,
            };
            const row = getRow(g);
            for (const reqId of reqIds) {
                row._assignedSet.add(reqId);
                getPos(g.key, reqId)?._assignedSet.add(reqId);
            }
        }
    }
    for (const c of candidates) {
        if (!isSubmission(c))
            continue;
        const subAt = submissionDate(c);
        const g = groupOf(c);
        const row = getRow(g);
        const pos = getPos(g.key, c.requirementId);
        if (groupBy === 'vendor' && c.vendorId) {
            const assigned = assignedByVendor.get(c.vendorId);
            if (assigned) {
                for (const reqId of assigned)
                    row._assignedSet.add(reqId);
            }
        }
        if (inRange(subAt)) {
            row.profiles += 1;
            if (pos)
                pos.profiles += 1;
            addName(g.key, 'profiles', c.name, subAt, c.requirementId);
            if (c.requirementId) {
                row._jobSet.add(c.requirementId);
                pos?._jobSet.add(c.requirementId);
            }
            if (c.matchScore > 0) {
                row._matchSum += c.matchScore;
                row._matchCount += 1;
                if (pos) {
                    pos._matchSum += c.matchScore;
                    pos._matchCount += 1;
                }
            }
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
        if (isRejected(c.status) && inRange(c.updatedAt)) {
            row.rejects += 1;
            if (pos)
                pos.rejects += 1;
            addName(g.key, 'rejects', c.name, c.updatedAt, c.requirementId);
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
        else if (c.expectedJoiningDate &&
            inRange(c.expectedJoiningDate) &&
            c.expectedJoiningDate.getTime() < now &&
            (c.status === 'OFFERED' || c.status === 'OFFER_ACCEPTED' || c.status === 'TO_BE_OFFERED')) {
            row.noShow += 1;
            if (pos)
                pos.noShow += 1;
            addName(g.key, 'noShow', c.name, c.expectedJoiningDate, c.requirementId);
        }
        else if (c.status === 'OFFER_DECLINED' && inRange(c.updatedAt)) {
            row.noShow += 1;
            if (pos)
                pos.noShow += 1;
            addName(g.key, 'noShow', c.name, c.updatedAt, c.requirementId);
        }
    }
    for (const i of interviews) {
        if (!vendorCandIds.has(i.candidateId))
            continue;
        if (!inRange(i.scheduledAt) && !inRange(i.createdAt))
            continue;
        const cand = candById.get(i.candidateId);
        if (!cand)
            continue;
        const g = groupOf(cand);
        const row = getRow(g);
        const reqId = i.requirementId || cand.requirementId;
        const pos = getPos(g.key, reqId);
        const eventDate = inRange(i.scheduledAt) ? i.scheduledAt : i.createdAt;
        row.interviews += 1;
        if (pos)
            pos.interviews += 1;
        addName(g.key, 'interviews', cand.name, eventDate, reqId, `interview:${i.id}`);
    }
    for (const o of offers) {
        if (!vendorCandIds.has(o.candidateId))
            continue;
        const cand = candById.get(o.candidateId);
        if (!cand || !isJoined(cand.status))
            continue;
        const joinAt = cand.joiningDate ?? cand.updatedAt;
        if (!inRange(joinAt))
            continue;
        const ctc = offerCtcToAnnualInr(o);
        if (!(ctc > 0))
            continue;
        const g = groupOf(cand);
        const row = getRow(g);
        const reqId = o.requirementId || cand.requirementId;
        const pos = getPos(g.key, reqId);
        row.onboardedCtc += ctc;
        if (pos)
            pos.onboardedCtc += ctc;
    }
    for (const row of rows.values())
        finalizeDerived(row);
    for (const map of positionsByRow.values()) {
        for (const pos of map.values())
            finalizeDerived(pos);
    }
    const sortedRows = [...rows.values()]
        .filter((r) => r.profiles > 0 ||
        r.joins > 0 ||
        r.interviews > 0 ||
        r.assignedJobs > 0)
        .sort((a, b) => {
        if (a.label === UNASSIGNED)
            return 1;
        if (b.label === UNASSIGNED)
            return -1;
        return a.label.localeCompare(b.label);
    })
        .map((row) => {
        const { _matchSum, _matchCount, _jobSet, _assignedSet, ...rest } = row;
        void _matchSum;
        void _matchCount;
        void _jobSet;
        void _assignedSet;
        const positions = [...(positionsByRow.get(row.key)?.values() ?? [])]
            .map((pos) => {
            const { _matchSum: __ms, _matchCount: __mc, _jobSet: __js, _assignedSet: __as, ...posRest } = pos;
            void __ms;
            void __mc;
            void __js;
            void __as;
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
    let matchSum = 0;
    let matchCount = 0;
    const assignedAll = new Set();
    const jobsAll = new Set();
    const totalAcc = emptyMetrics();
    for (const row of rows.values()) {
        matchSum += row._matchSum;
        matchCount += row._matchCount;
        for (const id of row._assignedSet)
            assignedAll.add(`${row.key}:${id}`);
        for (const id of row._jobSet)
            jobsAll.add(`${row.key}:${id}`);
    }
    for (const row of sortedRows) {
        for (const key of METRIC_KEYS) {
            if (key === 'conversionPct' ||
                key === 'avgMatchScore' ||
                key === 'assignedJobs' ||
                key === 'jobsSubmitted') {
                continue;
            }
            totalAcc[key] += row[key];
        }
        for (const key of CANDIDATE_KEYS) {
            for (const [idx, entry] of (row.names[key] ?? []).entries()) {
                totalBuckets[key].set(`${row.key}:${entry.name}:${entry.date ?? ''}:${idx}`, entry);
            }
        }
    }
    totalAcc.assignedJobs = assignedAll.size;
    totalAcc.jobsSubmitted = jobsAll.size;
    totalAcc.conversionPct = pct(totalAcc.joins, totalAcc.profiles);
    totalAcc.avgMatchScore = avg(matchSum, matchCount);
    return {
        rows: sortedRows,
        total: {
            label: 'Total',
            ...totalAcc,
            names: finalizeNames(totalBuckets),
        },
    };
}
