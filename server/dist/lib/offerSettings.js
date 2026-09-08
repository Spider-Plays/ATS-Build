import { prisma } from './prisma.js';
import { DEFAULT_COMPENSATION_CONFIG, } from './offerCompensation.js';
import { mergeOfferLetterTemplate, } from './offerLetterTemplate.js';
import { ensureAppSettingTable } from './ensureAppSettingTable.js';
export const COMPENSATION_CONFIG_KEY = 'compensation_config';
export const OFFER_LETTER_TEMPLATE_KEY = 'offer_letter_template';
let tableReady = false;
async function ensureTable() {
    if (tableReady)
        return;
    await ensureAppSettingTable();
    tableReady = true;
}
function parseJson(raw, fallback) {
    if (!raw)
        return fallback;
    try {
        return { ...fallback, ...JSON.parse(raw) };
    }
    catch {
        return fallback;
    }
}
async function readSetting(key) {
    await ensureTable();
    const rows = await prisma.$queryRaw `
    SELECT value FROM "AppSetting" WHERE key = ${key} LIMIT 1
  `;
    return rows[0]?.value ?? null;
}
async function writeSetting(key, value, updatedBy) {
    await ensureTable();
    await prisma.$executeRaw `
    INSERT INTO "AppSetting" (key, value, "updatedBy", "updatedAt")
    VALUES (${key}, ${value}, ${updatedBy}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      "updatedBy" = EXCLUDED."updatedBy",
      "updatedAt" = NOW()
  `;
}
export async function getCompensationConfig() {
    const raw = await readSetting(COMPENSATION_CONFIG_KEY);
    return parseJson(raw, { ...DEFAULT_COMPENSATION_CONFIG });
}
export async function setCompensationConfig(config, updatedBy) {
    const merged = parseJson(JSON.stringify(config), { ...DEFAULT_COMPENSATION_CONFIG });
    await writeSetting(COMPENSATION_CONFIG_KEY, JSON.stringify(merged), updatedBy);
    return merged;
}
export async function getOfferLetterTemplate() {
    const raw = await readSetting(OFFER_LETTER_TEMPLATE_KEY);
    if (!raw) {
        return mergeOfferLetterTemplate(null);
    }
    try {
        return mergeOfferLetterTemplate(JSON.parse(raw));
    }
    catch {
        return mergeOfferLetterTemplate(null);
    }
}
export async function setOfferLetterTemplate(template, updatedBy) {
    const merged = mergeOfferLetterTemplate(template);
    await writeSetting(OFFER_LETTER_TEMPLATE_KEY, JSON.stringify(merged), updatedBy);
    return merged;
}
