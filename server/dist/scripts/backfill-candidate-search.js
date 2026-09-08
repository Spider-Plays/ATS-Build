/**
 * Backfill experienceYears / CTC / notice / searchText on all candidates.
 *
 * Usage: cd server && npx tsx src/scripts/backfill-candidate-search.ts
 */
import { prisma } from '../lib/prisma.js';
import { ensureCandidateSearchColumns } from '../lib/ensureCandidateSearchColumns.js';
import { buildCandidateSearchIndexFields } from '../lib/candidateFieldNormalize.js';
const BATCH = 100;
async function main() {
    await ensureCandidateSearchColumns();
    let cursor;
    let updated = 0;
    for (;;) {
        const rows = await prisma.candidate.findMany({
            take: BATCH,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' },
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
            const fields = buildCandidateSearchIndexFields(row);
            await prisma.candidate.update({
                where: { id: row.id },
                data: fields,
            });
            updated += 1;
        }
        cursor = rows[rows.length - 1].id;
        console.log(`Backfilled ${updated} candidates…`);
    }
    console.log(`Done. Updated ${updated} candidates.`);
}
main()
    .catch((err) => {
    console.error(err);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
