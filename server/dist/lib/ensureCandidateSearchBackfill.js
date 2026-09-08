import { prisma } from './prisma.js';
import { buildCandidateSearchIndexFields } from './candidateFieldNormalize.js';
const BATCH = 50;
/** Backfill searchText / numeric helpers when columns exist but rows are empty. */
export async function ensureCandidateSearchBackfill() {
    const missing = await prisma.candidate.count({
        where: { OR: [{ searchText: null }, { searchText: '' }] },
    });
    if (missing === 0)
        return;
    console.log(`[candidate-search] Backfilling search index for ${missing} candidates…`);
    let cursor;
    let updated = 0;
    for (;;) {
        const rows = await prisma.candidate.findMany({
            take: BATCH,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' },
            where: { OR: [{ searchText: null }, { searchText: '' }] },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                jobTitle: true,
                location: true,
                currentCompany: true,
                primarySkills: true,
                secondarySkills: true,
                resumeText: true,
                totalExperience: true,
                currentCTC: true,
                expectedCTC: true,
                noticePeriod: true,
            },
        });
        if (rows.length === 0)
            break;
        for (const row of rows) {
            await prisma.candidate.update({
                where: { id: row.id },
                data: buildCandidateSearchIndexFields(row),
            });
            updated += 1;
        }
        cursor = rows[rows.length - 1].id;
    }
    console.log(`[candidate-search] Backfill complete (${updated} updated).`);
}
