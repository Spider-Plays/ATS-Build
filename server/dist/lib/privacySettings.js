import { prisma } from './prisma.js';
import { ensureAppSettingTable } from './ensureAppSettingTable.js';
const KEY = 'privacy.settings';
export const RETENTION_GROUPS = [
    'unsuccessful',
    'stale',
    'activeClosed',
    'talentPool',
    'referralClosed',
    'hired',
];
export const RETENTION_GROUP_LABELS = {
    unsuccessful: {
        label: 'Unsuccessful',
        description: 'Any reject status, offer declined, candidate or position abort.',
    },
    stale: {
        label: 'Stale or paused',
        description: 'To be screened and On hold with no activity.',
    },
    activeClosed: {
        label: 'Active, requisition closed',
        description: 'In the pipeline or offer stage when the requisition was closed or cancelled.',
    },
    talentPool: {
        label: 'Talent pool',
        description: 'Bank candidates and banked referrals.',
    },
    referralClosed: {
        label: 'Referral rejected',
        description: 'Employee referrals rejected at the review gate.',
    },
    hired: {
        label: 'Hired (joined)',
        description: 'Resume, PAN, CTC and feedback are removed. A minimal hire record stays.',
    },
};
const DEFAULT_PERIOD_DAYS = 180;
const DEFAULTS = {
    mode: 'dry_run',
    action: 'anonymize',
    periodDays: {
        unsuccessful: DEFAULT_PERIOD_DAYS,
        stale: DEFAULT_PERIOD_DAYS,
        activeClosed: DEFAULT_PERIOD_DAYS,
        talentPool: DEFAULT_PERIOD_DAYS,
        referralClosed: DEFAULT_PERIOD_DAYS,
        hired: DEFAULT_PERIOD_DAYS,
    },
    hiredRecordDays: 2555,
    batchSize: 500,
    runHourIst: 2,
};
function envInt(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
/** Hard limits from the environment. The UI and API cannot go outside them. */
export function getRetentionBounds() {
    const minDays = envInt('RETENTION_MIN_DAYS', 30);
    const maxDays = Math.max(minDays, envInt('RETENTION_MAX_DAYS', 3650));
    return { minDays, maxDays, maxBatchSize: envInt('RETENTION_MAX_BATCH_SIZE', 5000) };
}
function clampInt(value, min, max, fallback) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
/** Fills gaps with defaults and clamps every number into the allowed bounds. */
export function normalizePrivacySettings(input) {
    const raw = (input && typeof input === 'object' ? input : {});
    const bounds = getRetentionBounds();
    const rawPeriods = (raw.periodDays && typeof raw.periodDays === 'object' ? raw.periodDays : {});
    // Settings saved before per-group periods only had two numbers.
    const legacyUnsuccessful = raw.unsuccessfulRetentionDays;
    const legacyHired = raw.hiredRetentionDays;
    const periodDays = {};
    for (const group of RETENTION_GROUPS) {
        const fallback = group === 'unsuccessful' && legacyUnsuccessful != null
            ? Number(legacyUnsuccessful)
            : DEFAULTS.periodDays[group];
        periodDays[group] = clampInt(rawPeriods[group], bounds.minDays, bounds.maxDays, clampInt(fallback, bounds.minDays, bounds.maxDays, DEFAULTS.periodDays[group]));
    }
    const mode = raw.mode === 'off' || raw.mode === 'live' || raw.mode === 'dry_run' ? raw.mode : DEFAULTS.mode;
    const action = raw.action === 'delete' || raw.action === 'anonymize' ? raw.action : DEFAULTS.action;
    return {
        mode,
        action,
        periodDays,
        hiredRecordDays: clampInt(raw.hiredRecordDays ?? legacyHired, bounds.minDays, bounds.maxDays, DEFAULTS.hiredRecordDays),
        batchSize: clampInt(raw.batchSize, 1, bounds.maxBatchSize, DEFAULTS.batchSize),
        runHourIst: clampInt(raw.runHourIst, 0, 23, DEFAULTS.runHourIst),
    };
}
export async function getPrivacySettings() {
    await ensureAppSettingTable();
    const rows = await prisma.$queryRaw `
    SELECT value FROM "AppSetting" WHERE key = ${KEY} LIMIT 1
  `;
    if (!rows[0]?.value)
        return normalizePrivacySettings({});
    try {
        return normalizePrivacySettings(JSON.parse(rows[0].value));
    }
    catch {
        return normalizePrivacySettings({});
    }
}
export async function savePrivacySettings(next, updatedBy) {
    await ensureAppSettingTable();
    const clean = normalizePrivacySettings(next);
    const value = JSON.stringify(clean);
    await prisma.$executeRaw `
    INSERT INTO "AppSetting" (key, value, "updatedBy", "updatedAt")
    VALUES (${KEY}, ${value}, ${updatedBy}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      "updatedBy" = EXCLUDED."updatedBy",
      "updatedAt" = NOW()
  `;
    return clean;
}
/** Small JSON blobs kept in AppSetting (last run, run history). */
export async function readAppSettingJson(key) {
    await ensureAppSettingTable();
    const rows = await prisma.$queryRaw `
    SELECT value FROM "AppSetting" WHERE key = ${key} LIMIT 1
  `;
    if (!rows[0]?.value)
        return null;
    try {
        return JSON.parse(rows[0].value);
    }
    catch {
        return null;
    }
}
export async function writeAppSettingJson(key, value, updatedBy) {
    await ensureAppSettingTable();
    const json = JSON.stringify(value);
    await prisma.$executeRaw `
    INSERT INTO "AppSetting" (key, value, "updatedBy", "updatedAt")
    VALUES (${key}, ${json}, ${updatedBy}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      "updatedBy" = EXCLUDED."updatedBy",
      "updatedAt" = NOW()
  `;
}
