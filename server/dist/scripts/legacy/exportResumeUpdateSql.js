/**
 * Export resume fields for specific candidates as an UPDATE-only SQL file (+ their resume files),
 * for a hosted DB that already has those candidates from the main legacy import.
 *
 *   npm run db:legacy -- export-resume-update-sql --ids <ids.json> [--out <file.sql>] [--resumes-out <dir>]
 *
 * Updates only resume file name/type/text, skills, search fields and match score; nothing else is touched.
 * Aborts (changing nothing) if any candidate is missing on the target.
 */
import '../../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { RESUME_UPLOAD_DIR } from '../../lib/resumeStorage.js';
import { ident, lit } from './exportSql.js';
const COLUMNS = [
    'resumeFileName',
    'resumeMimeType',
    'resumeUrl',
    'resumeStorageKey',
    'resumeText',
    'primarySkills',
    'secondarySkills',
    'searchText',
    'experienceYears',
    'currentCtcLakhs',
    'expectedCtcLakhs',
    'noticePeriodDays',
    'matchScore',
    'updatedAt',
];
function arg(argv, name) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}
export async function run(argv = []) {
    const idsFile = arg(argv, '--ids');
    if (!idsFile)
        throw new Error('Missing --ids <file.json> (JSON array of candidate ids)');
    const ids = JSON.parse(fs.readFileSync(path.resolve(idsFile), 'utf8'));
    const dir = path.resolve(process.cwd(), 'data/main-import');
    const out = path.resolve(arg(argv, '--out') ?? path.join(dir, 'resumes-update-live.sql'));
    const resumesOut = path.resolve(arg(argv, '--resumes-out') ?? path.join(dir, 'resumes-update-for-server'));
    const rows = (await prisma.$queryRawUnsafe(`SELECT id, name, ${COLUMNS.map(ident).join(', ')} FROM "Candidate" WHERE id = ANY($1) ORDER BY name`, ids));
    if (rows.length !== ids.length)
        throw new Error(`Found ${rows.length} of ${ids.length} candidates locally`);
    const idArray = `ARRAY[${ids.map(lit).join(', ')}]::text[]`;
    const sql = [
        `-- Resume update → hosted ATS (run AFTER legacy-import-live.sql)`,
        `-- Generated ${new Date().toISOString()}: ${rows.length} candidate(s) get a resume, skills and match score.`,
        `-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ${path.basename(out)}`,
        `-- Then copy the files in ${path.basename(resumesOut)}/ into the server's RESUME_UPLOAD_DIR.`,
        `-- One transaction; safe to re-run.`,
        '',
        'BEGIN;',
        '',
        `DO $$`,
        `DECLARE missing int;`,
        `BEGIN`,
        `  SELECT count(*) INTO missing FROM unnest(${idArray}) AS c(id) WHERE NOT EXISTS (SELECT 1 FROM "Candidate" x WHERE x.id = c.id);`,
        `  IF missing > 0 THEN`,
        `    RAISE EXCEPTION '% candidate(s) are not on this database. Run legacy-import-live.sql first.', missing;`,
        `  END IF;`,
        `END $$;`,
        '',
    ];
    for (const r of rows) {
        sql.push(`-- ${String(r.name).replace(/\n/g, ' ')}`, `UPDATE "Candidate" SET ${COLUMNS.map((c) => `${ident(c)} = ${lit(r[c])}`).join(', ')} WHERE id = ${lit(r.id)};`);
    }
    sql.push('', `SELECT 'candidates with resume' AS what, count(*) FROM "Candidate" WHERE id = ANY(${idArray}) AND "resumeFileName" IS NOT NULL;`, '', 'COMMIT;', '');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, sql.join('\n'), 'utf8');
    fs.mkdirSync(resumesOut, { recursive: true });
    const wanted = new Set(ids);
    let copied = 0;
    for (const name of fs.readdirSync(RESUME_UPLOAD_DIR)) {
        if (!wanted.has(name.replace(/\.[^.]+$/, '')))
            continue;
        fs.copyFileSync(path.join(RESUME_UPLOAD_DIR, name), path.join(resumesOut, name));
        copied++;
    }
    console.log(`SQL written: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB), ${rows.length} candidate(s)`);
    console.log(`Resumes copied: ${copied}/${ids.length} → ${resumesOut}`);
}
