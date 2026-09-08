import { prisma } from './prisma.js';
import { ensureAppSettingTable } from './ensureAppSettingTable.js';
const KEY = 'privacy.settings';
const DEFAULTS = {
    unsuccessfulRetentionDays: 365,
    hiredRetentionDays: 2555,
};
export async function getPrivacySettings() {
    await ensureAppSettingTable();
    const rows = await prisma.$queryRaw `
    SELECT value FROM "AppSetting" WHERE key = ${KEY} LIMIT 1
  `;
    if (!rows[0]?.value)
        return { ...DEFAULTS };
    try {
        const parsed = JSON.parse(rows[0].value);
        return {
            unsuccessfulRetentionDays: Number(parsed.unsuccessfulRetentionDays) || DEFAULTS.unsuccessfulRetentionDays,
            hiredRetentionDays: Number(parsed.hiredRetentionDays) || DEFAULTS.hiredRetentionDays,
        };
    }
    catch {
        return { ...DEFAULTS };
    }
}
export async function savePrivacySettings(next, updatedBy) {
    await ensureAppSettingTable();
    const value = JSON.stringify(next);
    await prisma.$executeRaw `
    INSERT INTO "AppSetting" (key, value, "updatedBy", "updatedAt")
    VALUES (${KEY}, ${value}, ${updatedBy}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      "updatedBy" = EXCLUDED."updatedBy",
      "updatedAt" = NOW()
  `;
    return next;
}
