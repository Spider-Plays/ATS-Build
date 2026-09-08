import { prisma } from './prisma.js';
import { DEFAULT_CLIENT_CATALOG } from '../config/defaultClients.js';
let cachedNames = null;
let cacheAt = 0;
const CACHE_MS = 60_000;
let requirementsSynced = false;
async function syncClientsFromRequirements() {
    const rows = await prisma.requirement.findMany({
        where: { client: { not: null } },
        select: { client: true },
        distinct: ['client'],
    });
    if (rows.length === 0)
        return;
    const names = [
        ...new Set(rows
            .map((row) => row.client?.trim())
            .filter((name) => Boolean(name))),
    ];
    if (names.length === 0)
        return;
    await prisma.clientCatalog.createMany({
        data: names.map((name) => ({ name })),
        skipDuplicates: true,
    });
}
export async function ensureDefaultClientCatalog() {
    const count = await prisma.clientCatalog.count();
    if (count === 0) {
        await prisma.clientCatalog.createMany({
            data: DEFAULT_CLIENT_CATALOG.map((name) => ({ name })),
            skipDuplicates: true,
        });
    }
    if (!requirementsSynced) {
        await syncClientsFromRequirements();
        requirementsSynced = true;
    }
    cachedNames = null;
}
export async function listClientCatalog() {
    await ensureDefaultClientCatalog();
    return prisma.clientCatalog.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
    });
}
export async function getCatalogClientNames() {
    const now = Date.now();
    if (cachedNames && now - cacheAt < CACHE_MS)
        return cachedNames;
    await ensureDefaultClientCatalog();
    const rows = await prisma.clientCatalog.findMany({ select: { name: true } });
    cachedNames = rows.map((r) => r.name);
    cacheAt = now;
    return cachedNames;
}
export const ONE_CLIENT_PER_REQUIREMENT_MSG = 'Only one client is allowed per requirement';
/** Normalizes API input to a single client name (rejects arrays and multi-value strings). */
export function parseRequirementClientInput(raw) {
    if (raw === null || raw === undefined) {
        throw new Error('Client is required');
    }
    if (Array.isArray(raw)) {
        if (raw.length === 0)
            throw new Error('Client is required');
        if (raw.length > 1)
            throw new Error(ONE_CLIENT_PER_REQUIREMENT_MSG);
        raw = raw[0];
    }
    if (typeof raw !== 'string') {
        throw new Error('Invalid client');
    }
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name)
        throw new Error('Client is required');
    if (/[,;|]/.test(name) || /\s+and\s+/i.test(name)) {
        throw new Error(ONE_CLIENT_PER_REQUIREMENT_MSG);
    }
    return name;
}
export async function resolveClientFromCatalog(client) {
    const name = parseRequirementClientInput(client);
    await ensureDefaultClientCatalog();
    const row = await prisma.clientCatalog.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (!row) {
        throw new Error('Select a client from the catalog');
    }
    return row.name;
}
export function invalidateClientCatalogCache() {
    cachedNames = null;
}
/** Call after bulk requirement imports so legacy client names appear in the catalog once. */
export async function refreshClientCatalogFromRequirements() {
    await syncClientsFromRequirements();
    invalidateClientCatalogCache();
}
