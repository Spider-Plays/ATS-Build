import { prisma } from './prisma.js';
import { getCatalogSkillNames } from './skillCatalog.js';
import { rankCandidatesForRequirement } from './profileMatching.js';
export function parseRequirementVersions(raw) {
    try {
        const arr = JSON.parse(raw || '[]');
        return Array.isArray(arr) ? arr : [];
    }
    catch {
        return [];
    }
}
export async function snapshotLinkedCandidates(requirementId) {
    const rows = await prisma.candidate.findMany({
        where: { requirementId },
        orderBy: { matchScore: 'desc' },
    });
    return rows.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        status: c.status,
        matchScore: Math.round(c.matchScore),
    }));
}
export async function snapshotMatchingProfiles(requirement, requirementId, candidateWhere = {}) {
    const candidates = await prisma.candidate.findMany({
        where: candidateWhere,
        orderBy: { updatedAt: 'desc' },
    });
    const catalog = await getCatalogSkillNames();
    const ranked = await rankCandidatesForRequirement(candidates, requirement, requirementId, catalog);
    const candidateById = new Map(candidates.map((c) => [c.id, c]));
    return ranked
        .filter((m) => m.alreadyLinked || m.matchScore >= 15)
        .slice(0, 12)
        .map((m) => {
        const c = candidateById.get(m.candidateId);
        return {
            candidateId: m.candidateId,
            name: c.name,
            matchScore: m.matchScore,
            alreadyLinked: m.alreadyLinked,
            linkedToOther: m.linkedToOther,
        };
    });
}
export async function appendRequirementVersion(requirementId, entry) {
    const existing = await prisma.requirement.findUnique({ where: { id: requirementId } });
    if (!existing)
        return null;
    const versions = parseRequirementVersions(existing.versions);
    const [linkedCandidates, matchingProfiles] = await Promise.all([
        snapshotLinkedCandidates(requirementId),
        snapshotMatchingProfiles(existing, requirementId, entry.candidateWhere ?? {}),
    ]);
    const nextVersion = entry.incrementVersion
        ? existing.currentVersion + 1
        : existing.currentVersion;
    versions.push({
        version: entry.incrementVersion ? existing.currentVersion : existing.currentVersion,
        changedBy: entry.changedBy,
        changedAt: new Date().toISOString(),
        kind: entry.kind ?? 'UPDATE',
        changes: entry.changes,
        linkedCandidates,
        matchingProfiles,
    });
    const row = await prisma.requirement.update({
        where: { id: requirementId },
        data: {
            versions: JSON.stringify(versions),
            ...(entry.incrementVersion ? { currentVersion: nextVersion } : {}),
            updatedAt: new Date(),
        },
    });
    return row;
}
