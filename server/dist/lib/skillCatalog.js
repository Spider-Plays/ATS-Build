import { prisma } from './prisma.js';
import { DEFAULT_SKILL_CATALOG } from '../config/defaultSkills.js';
let cachedNames = null;
let cacheAt = 0;
const CACHE_MS = 60_000;
let defaultsSynced = false;
/** Insert any default catalog skills missing from the database. */
export async function syncDefaultSkillCatalog() {
    const existing = await prisma.skillCatalog.findMany({ select: { name: true } });
    const existingLower = new Set(existing.map((row) => row.name.toLowerCase()));
    const toCreate = DEFAULT_SKILL_CATALOG.filter((skill) => !existingLower.has(skill.name.toLowerCase()));
    if (toCreate.length > 0) {
        await prisma.skillCatalog.createMany({
            data: toCreate.map((skill) => ({
                name: skill.name,
                category: skill.category,
            })),
            skipDuplicates: true,
        });
    }
    invalidateSkillCatalogCache();
    return toCreate.length;
}
export async function ensureDefaultSkillCatalog() {
    if (defaultsSynced)
        return;
    await syncDefaultSkillCatalog();
    defaultsSynced = true;
}
export function resetDefaultSkillCatalogSync() {
    defaultsSynced = false;
    invalidateSkillCatalogCache();
}
export async function listSkillCatalog() {
    await ensureDefaultSkillCatalog();
    return prisma.skillCatalog.findMany({
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, category: true },
    });
}
export async function getCatalogSkillNames() {
    const now = Date.now();
    if (cachedNames && now - cacheAt < CACHE_MS)
        return cachedNames;
    await ensureDefaultSkillCatalog();
    const rows = await prisma.skillCatalog.findMany({ select: { name: true } });
    cachedNames = rows.map((r) => r.name);
    cacheAt = now;
    return cachedNames;
}
export function invalidateSkillCatalogCache() {
    cachedNames = null;
}
