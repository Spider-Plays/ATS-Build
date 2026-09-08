import { prisma } from './prisma.js';
import { DEFAULT_DEPARTMENT_CATALOG } from '../config/defaultDepartments.js';
let cachedNames = null;
let cacheAt = 0;
const CACHE_MS = 60_000;
export async function ensureDefaultDepartmentCatalog() {
    const existing = await prisma.departmentCatalog.findMany({ select: { name: true } });
    const existingLower = new Set(existing.map((row) => row.name.toLowerCase()));
    const toCreate = DEFAULT_DEPARTMENT_CATALOG.filter((name) => !existingLower.has(name.toLowerCase()));
    if (toCreate.length === 0)
        return;
    await prisma.departmentCatalog.createMany({
        data: toCreate.map((name) => ({ name })),
        skipDuplicates: true,
    });
    cachedNames = null;
}
export async function listDepartmentCatalog() {
    await ensureDefaultDepartmentCatalog();
    return prisma.departmentCatalog.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
    });
}
export async function getCatalogDepartmentNames() {
    const now = Date.now();
    if (cachedNames && now - cacheAt < CACHE_MS)
        return cachedNames;
    await ensureDefaultDepartmentCatalog();
    const rows = await prisma.departmentCatalog.findMany({ select: { name: true } });
    cachedNames = rows.map((r) => r.name);
    cacheAt = now;
    return cachedNames;
}
export function invalidateDepartmentCatalogCache() {
    cachedNames = null;
}
