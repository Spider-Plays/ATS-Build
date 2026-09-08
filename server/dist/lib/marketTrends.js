import { randomUUID } from 'crypto';
import { prisma } from './prisma.js';
import { parseFeatureTags, hasFeatureTag } from './userTags.js';
import { getAllowedPagesForRole } from './pageAccess.js';
import { DEFAULT_LOCATION_MULTIPLIERS, DEFAULT_SKILL_MARKET_ROWS, EXPERIENCE_BANDS, } from './marketTrendsSeed.js';
export { EXPERIENCE_BANDS };
export function round1(n) {
    return Math.round(n * 10) / 10;
}
export function isExperienceBand(value) {
    return EXPERIENCE_BANDS.includes(value);
}
export function parseBands(raw) {
    if (!Array.isArray(raw) || raw.length !== EXPERIENCE_BANDS.length)
        return null;
    const bands = [];
    for (let i = 0; i < EXPERIENCE_BANDS.length; i++) {
        const item = raw[i];
        if (!item || typeof item !== 'object')
            return null;
        const experience = String(item.experience ?? '');
        const minCtc = Number(item.minCtc);
        const maxCtc = Number(item.maxCtc);
        if (!isExperienceBand(experience) || experience !== EXPERIENCE_BANDS[i])
            return null;
        if (!Number.isFinite(minCtc) || !Number.isFinite(maxCtc))
            return null;
        bands.push({ experience, minCtc, maxCtc });
    }
    return bands;
}
export function findBand(bands, experience) {
    return bands.find((b) => b.experience === experience) ?? null;
}
export function baseExpectedCtc(minCtc, maxCtc) {
    return round1((minCtc + maxCtc) / 2);
}
export function forecastExpectedCtc(bands, experience, locationMultiplier) {
    const band = findBand(bands, experience);
    if (!band || !Number.isFinite(locationMultiplier) || locationMultiplier <= 0)
        return null;
    return round1(baseExpectedCtc(band.minCtc, band.maxCtc) * locationMultiplier);
}
export function canEditMarketData(role, tags) {
    if (!role)
        return false;
    if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'HR_HEAD' || role === 'HR_MANAGER') {
        return true;
    }
    return hasFeatureTag(role, tags, 'market_data');
}
export async function userCanAccessMarketTrendsPage(role) {
    if (role === 'SUPER_ADMIN')
        return true;
    const pages = await getAllowedPagesForRole(role);
    return pages.includes('market_trends');
}
/** Read-only market CTC for requisition forms (roles with requirements access). */
export async function userCanReadMarketTrends(role) {
    if (role === 'SUPER_ADMIN')
        return true;
    const pages = await getAllowedPagesForRole(role);
    return pages.includes('market_trends') || pages.includes('requirements');
}
export async function resolveCanEditMarketData(userId, role) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { permissions: true, role: true },
    });
    const tags = parseFeatureTags(user?.permissions);
    return canEditMarketData(user?.role ?? role, tags);
}
function mapSkillRow(row) {
    const bands = parseBands(row.bands) ?? EXPERIENCE_BANDS.map((experience) => ({
        experience,
        minCtc: 0,
        maxCtc: 0,
    }));
    return {
        id: row.id,
        capabilityArea: row.capabilityArea,
        framework: row.framework,
        scriptingLanguage: row.scriptingLanguage,
        toolsTechnologies: row.toolsTechnologies,
        sortOrder: row.sortOrder,
        bands,
    };
}
export async function listMarketTrends() {
    const [skills, locations] = await Promise.all([
        prisma.skillMarketRow.findMany({ orderBy: [{ sortOrder: 'asc' }, { capabilityArea: 'asc' }] }),
        prisma.locationMultiplier.findMany({ orderBy: [{ sortOrder: 'asc' }, { location: 'asc' }] }),
    ]);
    return {
        skills: skills.map(mapSkillRow),
        locations: locations.map((l) => ({
            id: l.id,
            location: l.location,
            multiplier: l.multiplier,
            sortOrder: l.sortOrder,
        })),
    };
}
export async function createSkillMarketRow(input) {
    const maxOrder = await prisma.skillMarketRow.aggregate({ _max: { sortOrder: true } });
    const sortOrder = input.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1;
    const row = await prisma.skillMarketRow.create({
        data: {
            capabilityArea: input.capabilityArea.trim(),
            framework: input.framework.trim(),
            scriptingLanguage: input.scriptingLanguage.trim(),
            toolsTechnologies: input.toolsTechnologies.trim(),
            sortOrder,
            bands: input.bands,
        },
    });
    return mapSkillRow(row);
}
export async function updateSkillMarketRow(id, input) {
    try {
        const row = await prisma.skillMarketRow.update({
            where: { id },
            data: {
                capabilityArea: input.capabilityArea.trim(),
                framework: input.framework.trim(),
                scriptingLanguage: input.scriptingLanguage.trim(),
                toolsTechnologies: input.toolsTechnologies.trim(),
                bands: input.bands,
                ...(typeof input.sortOrder === 'number' ? { sortOrder: input.sortOrder } : {}),
            },
        });
        return mapSkillRow(row);
    }
    catch {
        return null;
    }
}
export async function deleteSkillMarketRow(id) {
    try {
        await prisma.skillMarketRow.delete({ where: { id } });
        return true;
    }
    catch {
        return false;
    }
}
export async function replaceLocationMultipliers(rows) {
    await prisma.$transaction(async (tx) => {
        await tx.locationMultiplier.deleteMany();
        await tx.locationMultiplier.createMany({
            data: rows.map((r, i) => ({
                id: randomUUID(),
                location: r.location.trim(),
                multiplier: r.multiplier,
                sortOrder: r.sortOrder ?? i + 1,
            })),
        });
    });
    return (await prisma.locationMultiplier.findMany({ orderBy: [{ sortOrder: 'asc' }, { location: 'asc' }] })).map((l) => ({
        id: l.id,
        location: l.location,
        multiplier: l.multiplier,
        sortOrder: l.sortOrder,
    }));
}
export async function seedMarketTrendsIfEmpty() {
    const [skillCount, locCount] = await Promise.all([
        prisma.skillMarketRow.count(),
        prisma.locationMultiplier.count(),
    ]);
    if (locCount === 0) {
        await prisma.locationMultiplier.createMany({
            data: DEFAULT_LOCATION_MULTIPLIERS.map((l) => ({
                id: randomUUID(),
                location: l.location,
                multiplier: l.multiplier,
                sortOrder: l.sortOrder,
            })),
        });
    }
    if (skillCount === 0) {
        await prisma.skillMarketRow.createMany({
            data: DEFAULT_SKILL_MARKET_ROWS.map((s, i) => ({
                id: randomUUID(),
                capabilityArea: s.capabilityArea,
                framework: s.framework,
                scriptingLanguage: s.scriptingLanguage,
                toolsTechnologies: s.toolsTechnologies,
                sortOrder: i + 1,
                bands: s.bands,
            })),
        });
    }
}
