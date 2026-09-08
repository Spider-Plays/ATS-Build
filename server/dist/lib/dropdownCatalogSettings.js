import { DEFAULT_DROPDOWN_CATALOGS, } from '../config/defaultDropdownCatalogs.js';
import { ensureAppSettingTable } from './ensureAppSettingTable.js';
import { prisma } from './prisma.js';
export const DROPDOWN_CATALOGS_KEY = 'dropdown_catalogs';
let tableReady = false;
async function ensureTable() {
    if (tableReady)
        return;
    await ensureAppSettingTable();
    tableReady = true;
}
function parseJson(raw) {
    if (!raw)
        return { ...DEFAULT_DROPDOWN_CATALOGS };
    try {
        const parsed = JSON.parse(raw);
        return mergeDropdownCatalogs(parsed);
    }
    catch {
        return { ...DEFAULT_DROPDOWN_CATALOGS };
    }
}
function normalizeStringList(items, fallback) {
    if (!Array.isArray(items))
        return [...fallback];
    const out = items
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    return out.length > 0 ? out : [...fallback];
}
function normalizeLabeledList(items, fallback) {
    if (!Array.isArray(items))
        return [...fallback];
    const out = items
        .map((item) => {
        if (!item || typeof item !== 'object')
            return null;
        const row = item;
        const value = typeof row.value === 'string' ? row.value.trim() : '';
        const label = typeof row.label === 'string' ? row.label.trim() : '';
        if (!value || !label)
            return null;
        return { value, label };
    })
        .filter((item) => item !== null);
    return out.length > 0 ? out : [...fallback];
}
function normalizeCityList(items, fallback) {
    if (!Array.isArray(items))
        return [...fallback];
    const out = items
        .map((item) => {
        if (!item || typeof item !== 'object')
            return null;
        const row = item;
        const city = typeof row.city === 'string' ? row.city.trim() : '';
        if (!city)
            return null;
        const state = typeof row.state === 'string' && row.state.trim() ? row.state.trim() : null;
        return { city, state };
    })
        .filter((item) => item !== null);
    const seen = new Set();
    const deduped = [];
    for (const row of out) {
        const key = row.city.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push(row);
    }
    return deduped.length > 0 ? deduped : [...fallback];
}
export function mergeDropdownCatalogs(partial) {
    return {
        cities: normalizeCityList(partial.cities, DEFAULT_DROPDOWN_CATALOGS.cities),
        candidateSources: normalizeStringList(partial.candidateSources, DEFAULT_DROPDOWN_CATALOGS.candidateSources),
        referralRelationships: normalizeStringList(partial.referralRelationships, DEFAULT_DROPDOWN_CATALOGS.referralRelationships),
        employmentTypes: normalizeLabeledList(partial.employmentTypes, DEFAULT_DROPDOWN_CATALOGS.employmentTypes),
        workModes: normalizeLabeledList(partial.workModes, DEFAULT_DROPDOWN_CATALOGS.workModes),
        seniorityLevels: normalizeLabeledList(partial.seniorityLevels, DEFAULT_DROPDOWN_CATALOGS.seniorityLevels),
        requirementPriorities: normalizeLabeledList(partial.requirementPriorities, DEFAULT_DROPDOWN_CATALOGS.requirementPriorities),
        businessTypes: normalizeLabeledList(partial.businessTypes, DEFAULT_DROPDOWN_CATALOGS.businessTypes),
        domains: normalizeLabeledList(partial.domains, DEFAULT_DROPDOWN_CATALOGS.domains),
        jobTypes: normalizeLabeledList(partial.jobTypes, DEFAULT_DROPDOWN_CATALOGS.jobTypes),
        employmentChannels: normalizeLabeledList(partial.employmentChannels, DEFAULT_DROPDOWN_CATALOGS.employmentChannels),
        requirementForOptions: normalizeLabeledList(partial.requirementForOptions, DEFAULT_DROPDOWN_CATALOGS.requirementForOptions),
        hireCategories: normalizeLabeledList(partial.hireCategories, DEFAULT_DROPDOWN_CATALOGS.hireCategories),
        educationOptions: normalizeLabeledList(partial.educationOptions, DEFAULT_DROPDOWN_CATALOGS.educationOptions),
    };
}
async function readSetting() {
    await ensureTable();
    const rows = await prisma.$queryRaw `
    SELECT value FROM "AppSetting" WHERE key = ${DROPDOWN_CATALOGS_KEY} LIMIT 1
  `;
    return rows[0]?.value ?? null;
}
async function writeSetting(value, updatedBy) {
    await ensureTable();
    await prisma.$executeRaw `
    INSERT INTO "AppSetting" (key, value, "updatedBy", "updatedAt")
    VALUES (${DROPDOWN_CATALOGS_KEY}, ${value}, ${updatedBy}, NOW())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      "updatedBy" = EXCLUDED."updatedBy",
      "updatedAt" = NOW()
  `;
}
export async function getDropdownCatalogs() {
    const raw = await readSetting();
    return parseJson(raw);
}
export async function setDropdownCatalogs(config, updatedBy) {
    const merged = mergeDropdownCatalogs(config);
    await writeSetting(JSON.stringify(merged), updatedBy);
    return merged;
}
export async function resetDropdownCatalogs(updatedBy) {
    const defaults = { ...DEFAULT_DROPDOWN_CATALOGS };
    await writeSetting(JSON.stringify(defaults), updatedBy);
    return defaults;
}
