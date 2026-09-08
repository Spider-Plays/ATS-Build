import { prisma } from './prisma.js';
import { DEFAULT_CITY_CATALOG } from '../config/defaultCities.js';
let cachedRows = null;
let cacheAt = 0;
const CACHE_MS = 60_000;
let defaultsSynced = false;
/** Insert any default catalog cities missing from the database. */
export async function syncDefaultCityCatalog() {
    const existing = await prisma.cityCatalog.findMany({ select: { city: true } });
    const existingLower = new Set(existing.map((row) => row.city.toLowerCase()));
    const toCreate = DEFAULT_CITY_CATALOG.filter((row) => !existingLower.has(row.city.toLowerCase()));
    if (toCreate.length > 0) {
        await prisma.cityCatalog.createMany({
            data: toCreate.map((row) => ({
                city: row.city,
                state: row.state,
            })),
            skipDuplicates: true,
        });
    }
    invalidateCityCatalogCache();
    return toCreate.length;
}
export async function ensureDefaultCityCatalog() {
    if (defaultsSynced)
        return;
    await syncDefaultCityCatalog();
    defaultsSynced = true;
}
export function resetDefaultCityCatalogSync() {
    defaultsSynced = false;
}
export async function listCityCatalog() {
    await ensureDefaultCityCatalog();
    const now = Date.now();
    if (cachedRows && now - cacheAt < CACHE_MS)
        return cachedRows;
    cachedRows = await prisma.cityCatalog.findMany({
        orderBy: { city: 'asc' },
        select: { id: true, city: true, state: true },
    });
    cacheAt = now;
    return cachedRows;
}
export function invalidateCityCatalogCache() {
    cachedRows = null;
}
export function formatCityName(raw) {
    return raw.trim().replace(/\s+/g, ' ');
}
