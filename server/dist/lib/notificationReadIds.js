import { prisma } from './prisma.js';
import { ensureAppSettingTable } from './ensureAppSettingTable.js';
const MAX_IDS = 800;
const KEY_PREFIX = 'notification-read-ids:';
let tableReady = false;
async function ensureTable() {
    if (tableReady)
        return;
    await ensureAppSettingTable();
    tableReady = true;
}
function settingKey(userId) {
    return `${KEY_PREFIX}${userId}`;
}
function normalizeIds(ids) {
    if (!Array.isArray(ids))
        return [];
    const cleaned = ids
        .filter((id) => typeof id === 'string' && id.trim().length > 0)
        .map((id) => id.trim());
    return [...new Set(cleaned)].slice(-MAX_IDS);
}
async function readRaw(userId) {
    await ensureTable();
    const key = settingKey(userId);
    const rows = await prisma.$queryRaw `
    SELECT value FROM "AppSetting" WHERE key = ${key} LIMIT 1
  `;
    const raw = rows[0]?.value;
    if (!raw)
        return [];
    try {
        return normalizeIds(JSON.parse(raw));
    }
    catch {
        return [];
    }
}
async function writeIds(userId, ids) {
    await ensureTable();
    const normalized = normalizeIds(ids);
    const key = settingKey(userId);
    const value = JSON.stringify(normalized);
    await prisma.$executeRaw `
    INSERT INTO "AppSetting" (key, value, "updatedBy", "updatedAt")
    VALUES (${key}, ${value}, ${userId}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      "updatedBy" = EXCLUDED."updatedBy",
      "updatedAt" = NOW()
  `;
    return normalized;
}
export async function getNotificationReadIds(userId) {
    return readRaw(userId);
}
/** Merge notification ids into the user's persisted read set. */
export async function markNotificationReadIds(userId, ids) {
    if (ids.length === 0)
        return readRaw(userId);
    const current = await readRaw(userId);
    return writeIds(userId, [...current, ...ids]);
}
