import { prisma } from './prisma.js';
import { DEFAULT_DEPARTMENT_CATALOG } from '../config/defaultDepartments.js';
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
}
export async function listDepartmentCatalog() {
    await ensureDefaultDepartmentCatalog();
    return prisma.departmentCatalog.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
    });
}
export function invalidateDepartmentCatalogCache() {
}
