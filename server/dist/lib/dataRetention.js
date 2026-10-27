import { prisma } from './prisma.js';
import { logActivity } from '../services/activityLog.js';
import { syncRequirementHiringState } from './hiring.js';
import { TERMINAL_POSTING_STATUSES } from './requirementHiring.js';
import { anonymizeCandidateRecords, eraseCandidateRecords } from './candidateErasure.js';
import { RETENTION_GROUPS, getPrivacySettings, readAppSettingJson, writeAppSettingJson, } from './privacySettings.js';
const LAST_RUN_KEY = 'privacy.retention.lastRun';
const HISTORY_KEY = 'privacy.retention.history';
const HISTORY_LIMIT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
const UNSUCCESSFUL_STATUSES = new Set([
    'SCREEN_REJECT',
    'L1_INTERVIEW_REJECT',
    'MANAGERIAL_INTERVIEW_REJECT',
    'CLIENT_INTERVIEW_REJECT',
    'HR_INTERVIEW_REJECT',
    'OFFER_DECLINED',
    'CANDIDATE_ABORT',
    'POSITION_ABORT',
]);
const STALE_STATUSES = new Set(['TO_BE_SCREENED', 'ON_HOLD']);
const ACTIVE_STATUSES = new Set([
    'SCREEN_SELECT',
    'L1_INTERVIEW',
    'MANAGERIAL_INTERVIEW',
    'CLIENT_INTERVIEW',
    'HR_INTERVIEW',
    'HR_INTERVIEW_SELECT',
    'TO_BE_OFFERED',
    'OFFERED',
    'OFFER_ACCEPTED',
]);
const TERMINAL_REQUISITION = new Set(TERMINAL_POSTING_STATUSES);
function emptyCounts() {
    return Object.fromEntries(RETENTION_GROUPS.map((g) => [g, 0]));
}
export function classifyCandidate(c, closedRequirementIds) {
    if (c.status === 'JOINED')
        return 'hired';
    if (c.referralStage === 'REJECTED')
        return 'referralClosed';
    if (c.referralStage === 'BANKED' || c.status === 'BANK')
        return 'talentPool';
    if (UNSUCCESSFUL_STATUSES.has(c.status))
        return 'unsuccessful';
    if (STALE_STATUSES.has(c.status))
        return 'stale';
    if (ACTIVE_STATUSES.has(c.status)) {
        return c.requirementId && closedRequirementIds.has(c.requirementId) ? 'activeClosed' : null;
    }
    return null;
}
function clockStart(c, group) {
    if (group === 'hired')
        return c.joiningDate ?? c.updatedAt;
    return c.updatedAt;
}
async function closedRequirementIdsFor(rows) {
    const ids = [...new Set(rows.map((r) => r.requirementId).filter((id) => Boolean(id)))];
    if (!ids.length)
        return new Set();
    const reqs = await prisma.requirement.findMany({
        where: { id: { in: ids }, status: { in: [...TERMINAL_REQUISITION] } },
        select: { id: true },
    });
    return new Set(reqs.map((r) => r.id));
}
const SELECT = {
    id: true,
    name: true,
    email: true,
    status: true,
    requirementId: true,
    referralStage: true,
    resumeStorageKey: true,
    updatedAt: true,
    joiningDate: true,
    anonymizedAt: true,
};
let running = false;
export function isRetentionRunning() {
    return running;
}
/**
 * Walks candidates oldest-first and handles those whose period has ended.
 * Dry runs only count. The batch size caps the changes made per run.
 */
export async function runDataRetention(settings, opts) {
    if (running)
        throw new Error('A retention run is already in progress');
    running = true;
    const now = opts.now ?? new Date();
    const startedAt = new Date().toISOString();
    const due = emptyCounts();
    const processed = emptyCounts();
    const sample = [];
    let hireRecordsDue = 0;
    let hireRecordsDeleted = 0;
    let remaining = 0;
    let failed = 0;
    let budget = settings.batchSize;
    const touchedRequirements = new Set();
    try {
        const cutoffs = Object.fromEntries(RETENTION_GROUPS.map((g) => [g, new Date(now.getTime() - settings.periodDays[g] * DAY_MS)]));
        const recordCutoff = new Date(now.getTime() - settings.hiredRecordDays * DAY_MS);
        const oldestCutoff = new Date(Math.min(...Object.values(cutoffs).map((d) => d.getTime())));
        let cursor;
        for (;;) {
            const page = (await prisma.candidate.findMany({
                where: {
                    OR: [
                        { anonymizedAt: null, updatedAt: { lt: oldestCutoff } },
                        { anonymizedAt: null, joiningDate: { lt: oldestCutoff } },
                        { anonymizedAt: { not: null }, status: 'JOINED' },
                    ],
                },
                select: SELECT,
                orderBy: { id: 'asc' },
                take: PAGE_SIZE,
                ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            }));
            if (!page.length)
                break;
            cursor = page[page.length - 1].id;
            const closed = await closedRequirementIdsFor(page);
            for (const c of page) {
                // Hired rows already stripped: only the final deletion of the minimal record is left.
                if (c.anonymizedAt) {
                    const start = c.joiningDate ?? c.anonymizedAt;
                    if (start >= recordCutoff)
                        continue;
                    hireRecordsDue += 1;
                    if (sample.length < 20)
                        sample.push({ id: c.id, group: 'hireRecord', status: c.status });
                    if (opts.dryRun || budget <= 0) {
                        if (!opts.dryRun)
                            remaining += 1;
                        continue;
                    }
                    try {
                        await eraseCandidateRecords({ id: c.id, email: c.email, resumeStorageKey: c.resumeStorageKey });
                        if (c.requirementId)
                            touchedRequirements.add(c.requirementId);
                        hireRecordsDeleted += 1;
                        budget -= 1;
                    }
                    catch (err) {
                        failed += 1;
                        console.error('[data-retention] hire record delete failed', c.id, err instanceof Error ? err.message : err);
                    }
                    continue;
                }
                const group = classifyCandidate(c, closed);
                if (!group)
                    continue;
                if (clockStart(c, group) >= cutoffs[group])
                    continue;
                due[group] += 1;
                if (sample.length < 20)
                    sample.push({ id: c.id, group, status: c.status });
                if (opts.dryRun)
                    continue;
                if (budget <= 0) {
                    remaining += 1;
                    continue;
                }
                try {
                    if (group !== 'hired' && settings.action === 'delete') {
                        await eraseCandidateRecords({ id: c.id, email: c.email, resumeStorageKey: c.resumeStorageKey });
                        if (c.requirementId)
                            touchedRequirements.add(c.requirementId);
                    }
                    else {
                        await anonymizeCandidateRecords(c, { group, keepName: group === 'hired', now });
                    }
                    processed[group] += 1;
                    budget -= 1;
                }
                catch (err) {
                    failed += 1;
                    console.error('[data-retention] failed for candidate', c.id, err instanceof Error ? err.message : err);
                }
            }
            if (page.length < PAGE_SIZE)
                break;
        }
        for (const requirementId of touchedRequirements) {
            await syncRequirementHiringState(requirementId, { notify: false }).catch(() => undefined);
        }
    }
    finally {
        running = false;
    }
    const result = {
        startedAt,
        finishedAt: new Date().toISOString(),
        trigger: opts.trigger,
        dryRun: opts.dryRun,
        mode: settings.mode,
        action: settings.action,
        due,
        processed,
        hireRecordsDue,
        hireRecordsDeleted,
        remaining,
        failed,
        sample,
    };
    if (opts.trigger !== 'preview')
        await recordRun(result, opts.performedBy ?? 'system');
    return result;
}
async function recordRun(result, performedBy) {
    await writeAppSettingJson(LAST_RUN_KEY, result, performedBy);
    const history = (await readAppSettingJson(HISTORY_KEY)) ?? [];
    const slim = { ...result, sample: [] };
    await writeAppSettingJson(HISTORY_KEY, [slim, ...history].slice(0, HISTORY_LIMIT), performedBy);
    const changed = Object.values(result.processed).reduce((a, b) => a + b, 0) + result.hireRecordsDeleted;
    if (!result.dryRun && changed > 0) {
        await logActivity({
            entityType: 'SYSTEM',
            entityId: 'data-retention',
            action: 'RETENTION_RUN',
            performedBy,
            performerName: performedBy === 'system' ? 'System' : undefined,
            details: { trigger: result.trigger, processed: result.processed, hireRecordsDeleted: result.hireRecordsDeleted, failed: result.failed },
            seed: true,
        });
    }
}
export async function getLastRetentionRun() {
    return readAppSettingJson(LAST_RUN_KEY);
}
export async function getRetentionHistory() {
    return (await readAppSettingJson(HISTORY_KEY)) ?? [];
}
function istParts(now) {
    const ist = new Date(now.getTime() + IST_OFFSET_MS);
    return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}
/** Checks hourly. Runs once per IST day, at or after the configured hour. */
export async function runScheduledRetention(now = new Date()) {
    const settings = await getPrivacySettings();
    if (settings.mode === 'off')
        return null;
    const { date, hour } = istParts(now);
    if (hour < settings.runHourIst)
        return null;
    const last = await getLastRetentionRun();
    if (last && last.trigger === 'schedule' && istParts(new Date(last.startedAt)).date === date)
        return null;
    return runDataRetention(settings, { dryRun: settings.mode !== 'live', trigger: 'schedule', now });
}
export function startDataRetentionJob() {
    const tick = () => runScheduledRetention().catch((err) => console.error('[data-retention]', err instanceof Error ? err.message : err));
    setTimeout(() => void tick(), 60 * 1000);
    setInterval(() => void tick(), 60 * 60 * 1000);
}
