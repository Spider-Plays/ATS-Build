/**
 * Re-apply Candidate sheet Status / Sub Status → ATS pipeline status.
 *
 *   npm run db:legacy -- sync-statuses --data-dir "...\data"
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { dedupeRowsByEmail, loadLegacyCsv, normalizeEmail, rowGet, } from '../../lib/legacyImport/parseCsv.js';
import { mapLegacyStatus, pipelineRank } from '../../lib/legacyImport/statusMap.js';
function parseDataDir(argv) {
    const idx = argv.indexOf('--data-dir');
    const dataDir = idx >= 0 ? argv[idx + 1] : '';
    if (!dataDir)
        throw new Error('Missing --data-dir');
    return dataDir;
}
export async function run(argv = []) {
    const dataDir = parseDataDir(argv);
    const rows = loadLegacyCsv(dataDir);
    const { selected } = dedupeRowsByEmail(rows, pipelineRank);
    const expected = new Map();
    for (const row of selected) {
        const email = normalizeEmail(rowGet(row, 'Email ID', 'Email ID1'));
        const name = rowGet(row, 'Candidate Name');
        if (!email || !name)
            continue;
        expected.set(email, mapLegacyStatus(row));
    }
    const candidates = await prisma.candidate.findMany({
        select: { id: true, email: true, status: true },
    });
    let updated = 0;
    let matched = 0;
    let unchanged = 0;
    const changes = new Map();
    for (const c of candidates) {
        const want = expected.get(c.email.toLowerCase());
        if (!want)
            continue;
        matched++;
        if (want === c.status) {
            unchanged++;
            continue;
        }
        await prisma.candidate.update({
            where: { id: c.id },
            data: { status: want },
        });
        updated++;
        const key = `${c.status} → ${want}`;
        changes.set(key, (changes.get(key) || 0) + 1);
    }
    console.log(`Matched to CSV: ${matched}`);
    console.log(`Updated: ${updated}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log('Changes:', [...changes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30));
}
