/**
 * Build Excel migration report from CSV + import-manifest.json (no DB writes).
 *
 *   npm run db:legacy-report -- --data-dir "C:\...\data"
 */
import '../../config/loadEnv.js';
import path from 'path';
import { dedupeRowsByEmail, loadLegacyCsv, loadLegacyRequirementCsv, rowGet, } from '../../lib/legacyImport/parseCsv.js';
import { defaultManifestPath, loadManifest, createEmptyManifest, } from '../../lib/legacyImport/manifest.js';
import { pipelineRank } from '../../lib/legacyImport/statusMap.js';
import { buildImportReportRows, writeLegacyImportWorkbook, } from '../../lib/legacyImport/writeImportReport.js';
function parseArgs(argv) {
    let dataDir = '';
    let reportPath = '';
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--data-dir')
            dataDir = argv[++i] ?? '';
        else if (argv[i] === '--report')
            reportPath = argv[++i] ?? '';
    }
    if (!dataDir)
        throw new Error('Missing --data-dir');
    return {
        dataDir: path.resolve(dataDir),
        reportPath: reportPath
            ? path.resolve(reportPath)
            : path.join(path.resolve(dataDir), 'report.xlsx'),
    };
}
export async function run(argv = []) {
    const opts = parseArgs(argv);
    const rows = loadLegacyCsv(opts.dataDir);
    const requirementRows = loadLegacyRequirementCsv(opts.dataDir);
    const { selected, skipped } = dedupeRowsByEmail(rows, pipelineRank);
    const manifest = loadManifest(defaultManifestPath(opts.dataDir)) ?? createEmptyManifest(opts.dataDir);
    const reqIdsInForm = new Set(requirementRows.map((r) => rowGet(r, 'ReqID-New')).filter(Boolean));
    const missingReqIds = [
        ...new Set(selected
            .map((r) => rowGet(r, 'Title'))
            .filter((id) => id && !reqIdsInForm.has(id) && !manifest.requirements[id])),
    ];
    const reportRows = buildImportReportRows({
        allRows: rows,
        selected,
        skippedDuplicates: skipped,
        manifest,
        dataDir: opts.dataDir,
    });
    for (const row of reportRows) {
        const fromManifest = manifest.candidatesByEmail[row.email]?.candidateId;
        if (!row.candidateId && fromManifest) {
            row.candidateId = fromManifest;
            if (row.action === 'would_import')
                row.action = 'created';
        }
    }
    const written = await writeLegacyImportWorkbook({
        reportPath: opts.reportPath,
        dataDir: opts.dataDir,
        reportRows,
        skippedDuplicates: skipped,
        missingRequirementIds: missingReqIds,
        requirementCount: Object.keys(manifest.requirements).length,
    });
    console.log(`Excel report written: ${written}`);
}
