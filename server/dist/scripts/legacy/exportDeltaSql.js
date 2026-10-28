/**
 * Incremental (delta) export for a hosted DB that already has the earlier legacy imports.
 *
 *   npm run db:legacy -- delta-snapshot [--out <snapshot.json>]          # before applying updates locally
 *   npm run db:legacy -- export-delta-sql --snapshot <snapshot.json>      # after: export only new/changed rows
 *        [--out <file.sql>] [--resumes-out <dir>]
 *
 * The SQL upserts (by id) every requirement, interview plan/stage, candidate, interview, feedback, offer and
 * vendor link that is new or changed since the snapshot, creates missing users/vendors, and maps user/vendor
 * ids by email/name exactly like legacy-import-live.sql. One transaction; safe to re-run.
 */
import '../../config/loadEnv.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { isProtectedStitchEmail } from '../../lib/legacyImport/ensureStitchUser.js';
import { RESUME_UPLOAD_DIR } from '../../lib/resumeStorage.js';
import { ident, lit } from './exportSql.js';
/** Tables in insert order (stages FK plans; interviews FK stages). */
const TABLES = ['Requirement', 'InterviewPlan', 'InterviewPlanStage', 'Candidate', 'Interview', 'Feedback', 'Offer', 'VendorRequirement'];
const IGNORED_COLUMNS = new Set(['updatedAt']);
const CARRIED_ROLES = new Set(['RECRUITER', 'HIRING_MANAGER', 'VENDOR', 'INTERVIEWER']);
const LEGACY_VENDOR_NOTE = 'Created by legacy Manpower import';
const USER_ID_COLUMNS = {
    Requirement: ['hiringManager', 'createdBy', 'accountManager'],
    Candidate: ['createdBy', 'submittedByUserId', 'referredByUserId'],
    Interview: ['scheduledBy'],
    Feedback: ['interviewerId'],
    Offer: ['createdBy', 'respondedBy'],
    VendorRequirement: ['assignedBy'],
};
const USER_ID_TEXT_COLUMNS = {
    Requirement: ['recruiters', 'pendingRecruiters', 'approval', 'approvalHistory', 'versions'],
    InterviewPlanStage: ['defaultInterviewerIds'],
    Interview: ['interviewerIds'],
    Offer: ['approval', 'approvalHistory', 'approvalChainJson', 'history'],
};
function arg(argv, name) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}
function fingerprint(row) {
    const clean = {};
    for (const k of Object.keys(row).sort())
        if (!IGNORED_COLUMNS.has(k))
            clean[k] = row[k] instanceof Date ? row[k].toISOString() : row[k];
    return crypto.createHash('sha1').update(JSON.stringify(clean)).digest('hex');
}
async function allRows(table) {
    return (await prisma.$queryRawUnsafe(`SELECT * FROM ${ident(table)}`));
}
const DEFAULT_DIR = () => path.resolve(process.cwd(), 'data/main-import');
export async function runSnapshot(argv = []) {
    const out = path.resolve(arg(argv, '--out') ?? path.join(DEFAULT_DIR(), 'delta-snapshot.json'));
    const snap = {};
    for (const t of TABLES) {
        snap[t] = {};
        for (const r of await allRows(t))
            snap[t][String(r.id)] = fingerprint(r);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ takenAt: new Date().toISOString(), tables: snap }));
    console.log(`Snapshot written: ${out}`);
    for (const t of TABLES)
        console.log(`  ${t}: ${Object.keys(snap[t]).length}`);
}
function upsertStatements(table, rows, batchSize = 200) {
    if (rows.length === 0)
        return [];
    const cols = Object.keys(rows[0]);
    const updates = cols.filter((c) => c !== 'id').map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ');
    // A vendor link is just (vendor, requirement): if the target already has it under another id, keep that one.
    const onConflict = table === 'VendorRequirement' ? 'ON CONFLICT DO NOTHING' : `ON CONFLICT (id) DO UPDATE SET ${updates}`;
    const out = [];
    for (let i = 0; i < rows.length; i += batchSize) {
        const values = rows.slice(i, i + batchSize).map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n  ');
        out.push(`INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES\n  ${values}\n${onConflict};`);
    }
    return out;
}
/** Comparable form of a column value (dates by instant, everything else by JSON). */
function valueKey(v) {
    return v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null);
}
export async function runExport(argv = []) {
    const snapPath = arg(argv, '--snapshot');
    // --baseline-url: a database holding exactly what the server has; changed rows then update only differing columns.
    const baselineUrl = arg(argv, '--baseline-url');
    if (!snapPath && !baselineUrl) {
        throw new Error('Pass --snapshot <delta-snapshot.json> or --baseline-url <postgres url of a copy of the server data>');
    }
    const snap = snapPath
        ? JSON.parse(fs.readFileSync(path.resolve(snapPath), 'utf8'))
        : null;
    const baseline = baselineUrl ? new PrismaClient({ datasourceUrl: baselineUrl }) : null;
    const out = path.resolve(arg(argv, '--out') ?? path.join(DEFAULT_DIR(), 'delta-update-live.sql'));
    const resumesOut = path.resolve(arg(argv, '--resumes-out') ?? path.join(DEFAULT_DIR(), 'delta-resumes-for-server'));
    const changed = {};
    const counts = {};
    /** Baseline mode: id → columns that differ (absent = new row, inserted in full). */
    const changedCols = {};
    for (const t of TABLES) {
        changed[t] = [];
        counts[t] = { new: 0, changed: 0 };
        changedCols[t] = new Map();
        if (baseline) {
            const before = new Map((await baseline.$queryRawUnsafe(`SELECT * FROM ${ident(t)}`)).map((r) => [String(r.id), r]));
            for (const r of await allRows(t)) {
                const prev = before.get(String(r.id));
                if (!prev) {
                    changed[t].push(r);
                    counts[t].new++;
                    continue;
                }
                const cols = Object.keys(r).filter((c) => !IGNORED_COLUMNS.has(c) && valueKey(r[c]) !== valueKey(prev[c]));
                if (!cols.length)
                    continue;
                changed[t].push(r);
                changedCols[t].set(String(r.id), cols);
                counts[t].changed++;
            }
        }
        else {
            const before = snap.tables[t] ?? {};
            for (const r of await allRows(t)) {
                const prev = before[String(r.id)];
                if (prev === fingerprint(r))
                    continue;
                changed[t].push(r);
                counts[t][prev ? 'changed' : 'new']++;
            }
        }
    }
    await baseline?.$disconnect();
    // A new/changed plan needs all of its stages (FK), and new interviews need their stage.
    const planIds = new Set(changed.InterviewPlan.map((p) => String(p.id)));
    const stageIds = new Set(changed.InterviewPlanStage.map((s) => String(s.id)));
    for (const s of await allRows('InterviewPlanStage')) {
        if (planIds.has(String(s.planId)) && !stageIds.has(String(s.id))) {
            changed.InterviewPlanStage.push(s);
            stageIds.add(String(s.id));
        }
    }
    const vendors = (await prisma.$queryRawUnsafe(`SELECT * FROM "Vendor" WHERE notes = $1`, LEGACY_VENDOR_NOTE));
    const vendorIds = new Set(vendors.map((v) => String(v.id)));
    // Users referenced by the exported rows.
    const allUsers = await allRows('User');
    const userIdSet = new Set(allUsers.map((u) => String(u.id)));
    const referenced = new Set();
    for (const t of TABLES) {
        for (const row of changed[t]) {
            for (const col of USER_ID_COLUMNS[t] ?? [])
                if (typeof row[col] === 'string' && row[col])
                    referenced.add(String(row[col]));
            for (const col of USER_ID_TEXT_COLUMNS[t] ?? []) {
                for (const m of String(row[col] ?? '').matchAll(/c[a-z0-9]{24}/g))
                    if (userIdSet.has(m[0]))
                        referenced.add(m[0]);
            }
        }
    }
    for (const u of allUsers)
        if (u.vendorId && vendorIds.has(String(u.vendorId)))
            referenced.add(String(u.id));
    const users = allUsers.filter((u) => referenced.has(String(u.id)));
    const carriedIds = new Set(users.filter((u) => CARRIED_ROLES.has(String(u.role)) && !isProtectedStitchEmail(String(u.email))).map((u) => String(u.id)));
    const idArray = (ids) => `ARRAY[${ids.map(lit).join(', ')}]::text[]`;
    const total = TABLES.reduce((n, t) => n + changed[t].length, 0);
    const sql = [
        `-- Delta update → hosted ATS (run AFTER the earlier legacy SQL files)`,
        `-- Generated ${new Date().toISOString()}; changes since ${snap ? `snapshot ${snap.takenAt}` : "the server baseline"}. Changed rows update only the columns that differ.`,
        ...TABLES.map((t) => `--   ${t}: ${counts[t].new} new, ${counts[t].changed} changed`),
        `-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ${path.basename(out)}`,
        `-- Then copy ${path.basename(resumesOut)}/ into the server's RESUME_UPLOAD_DIR.`,
        `-- One transaction; safe to re-run.`,
        '',
        'BEGIN;',
        '',
        `DO $$ BEGIN`,
        `  IF NOT EXISTS (SELECT 1 FROM "Candidate" WHERE "legacyResumeId" IS NOT NULL) THEN`,
        `    RAISE EXCEPTION 'No legacy candidates on this database. Run legacy-import-live.sql first.'; END IF;`,
        `  IF NOT EXISTS (SELECT 1 FROM "User" WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE') THEN`,
        `    RAISE EXCEPTION 'Target has no active SUPER_ADMIN to own unmapped records.'; END IF;`,
        `END $$;`,
        '',
        `CREATE TEMP TABLE _d_vendor_map (old_id text PRIMARY KEY, name text NOT NULL, new_id text) ON COMMIT DROP;`,
    ];
    for (const v of vendors) {
        const cols = Object.keys(v);
        sql.push(`INSERT INTO _d_vendor_map (old_id, name) VALUES (${lit(v.id)}, ${lit(v.name)});`, `INSERT INTO "Vendor" (${cols.map(ident).join(', ')}) SELECT ${cols.map((c) => lit(v[c])).join(', ')}` +
            ` WHERE NOT EXISTS (SELECT 1 FROM "Vendor" WHERE lower(name) = lower(${lit(v.name)})) AND NOT EXISTS (SELECT 1 FROM "Vendor" WHERE code = ${lit(v.code)} OR id = ${lit(v.id)});`);
    }
    sql.push(`UPDATE _d_vendor_map m SET new_id = COALESCE((SELECT id FROM "Vendor" v WHERE lower(v.name) = lower(m.name) ORDER BY v."createdAt" LIMIT 1), (SELECT id FROM "Vendor" v WHERE v.id = m.old_id));`, '', `CREATE TEMP TABLE _d_user_map (old_id text PRIMARY KEY, email text NOT NULL, new_id text) ON COMMIT DROP;`);
    for (const u of users) {
        sql.push(`INSERT INTO _d_user_map (old_id, email) VALUES (${lit(u.id)}, ${lit(u.email)});`);
        if (!carriedIds.has(String(u.id)))
            continue;
        const row = {
            ...u,
            passwordHash: null,
            mustChangePassword: false,
            lastLogin: null,
            passwordResetToken: null,
            passwordResetExpires: null,
            googleId: null,
            microsoftId: null,
            referralCode: null,
            tokenVersion: 0,
        };
        const cols = Object.keys(row);
        sql.push(`INSERT INTO "User" (${cols.map(ident).join(', ')}) SELECT ${cols.map((c) => lit(row[c])).join(', ')}` +
            ` WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE lower(email) = lower(${lit(u.email)})) AND NOT EXISTS (SELECT 1 FROM "User" WHERE id = ${lit(u.id)});`);
    }
    sql.push(`UPDATE _d_user_map m SET new_id = COALESCE((SELECT id FROM "User" u WHERE lower(u.email) = lower(m.email) LIMIT 1),`, `  (SELECT id FROM "User" WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' ORDER BY "createdAt" LIMIT 1));`, `UPDATE "User" u SET "vendorId" = m.new_id FROM _d_vendor_map m WHERE u."vendorId" = m.old_id AND u.id IN (SELECT new_id FROM _d_user_map);`, '');
    for (const t of TABLES) {
        const fullRows = changed[t].filter((r) => !changedCols[t].has(String(r.id)));
        const updates = changed[t].filter((r) => changedCols[t].has(String(r.id))).map((r) => {
            const cols = changedCols[t].get(String(r.id));
            return `UPDATE ${ident(t)} SET ${cols.map((c) => `${ident(c)} = ${lit(r[c])}`).join(', ')} WHERE id = ${lit(r.id)};`;
        });
        sql.push(`-- ${t}: ${counts[t].new} new, ${counts[t].changed} changed`, ...upsertStatements(t, fullRows), ...updates, '');
    }
    sql.push(`CREATE TEMP TABLE _d_rows (tbl text, id text) ON COMMIT DROP;`);
    for (const t of TABLES)
        if (changed[t].length)
            sql.push(`INSERT INTO _d_rows SELECT ${lit(t)}, unnest(${idArray(changed[t].map((r) => String(r.id)))});`);
    sql.push(`DO $$`, `DECLARE m record;`, `BEGIN`, `  FOR m IN SELECT old_id, new_id FROM _d_user_map WHERE new_id IS DISTINCT FROM old_id LOOP`);
    for (const [t, cols] of Object.entries(USER_ID_COLUMNS)) {
        for (const c of cols)
            sql.push(`    UPDATE ${ident(t)} SET ${ident(c)} = m.new_id WHERE ${ident(c)} = m.old_id AND id IN (SELECT id FROM _d_rows WHERE tbl = ${lit(t)});`);
    }
    for (const [t, cols] of Object.entries(USER_ID_TEXT_COLUMNS)) {
        for (const c of cols) {
            sql.push(`    UPDATE ${ident(t)} SET ${ident(c)} = replace(${ident(c)}, m.old_id, m.new_id) WHERE strpos(${ident(c)}, m.old_id) > 0 AND id IN (SELECT id FROM _d_rows WHERE tbl = ${lit(t)});`);
        }
    }
    sql.push(`  END LOOP;`, `END $$;`, '');
    sql.push(`UPDATE "Candidate" c SET "vendorId" = m.new_id FROM _d_vendor_map m WHERE c."vendorId" = m.old_id AND m.new_id IS DISTINCT FROM m.old_id AND c.id IN (SELECT id FROM _d_rows WHERE tbl = 'Candidate');`, `UPDATE "VendorRequirement" r SET "vendorId" = m.new_id FROM _d_vendor_map m WHERE r."vendorId" = m.old_id AND m.new_id IS DISTINCT FROM m.old_id AND r.id IN (SELECT id FROM _d_rows WHERE tbl = 'VendorRequirement');`, '', `SELECT tbl AS what, count(*) FROM _d_rows GROUP BY tbl ORDER BY tbl;`, '', 'COMMIT;', '');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, sql.join('\n'), 'utf8');
    // Resume files saved since the snapshot (the server already has the older ones).
    fs.rmSync(resumesOut, { recursive: true, force: true });
    fs.mkdirSync(resumesOut, { recursive: true });
    // Baseline mode: new candidates with a resume, or rows whose resume columns changed. Snapshot mode: files saved since it.
    const wanted = new Set(changed.Candidate.filter((c) => {
        if (!c.resumeFileName)
            return false;
        const cols = changedCols.Candidate.get(String(c.id));
        return !baseline || !cols || cols.includes('resumeFileName') || cols.includes('resumeText');
    }).map((c) => String(c.id)));
    const since = snap ? new Date(snap.takenAt).getTime() : 0;
    let copied = 0;
    for (const name of fs.readdirSync(RESUME_UPLOAD_DIR)) {
        if (!wanted.has(name.replace(/\.[^.]+$/, '')))
            continue;
        if (fs.statSync(path.join(RESUME_UPLOAD_DIR, name)).mtimeMs < since)
            continue;
        fs.copyFileSync(path.join(RESUME_UPLOAD_DIR, name), path.join(resumesOut, name));
        copied++;
    }
    console.log(`SQL written: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB), ${total} row(s)`);
    for (const t of TABLES)
        console.log(`  ${t}: ${counts[t].new} new, ${counts[t].changed} changed${changed[t].length !== counts[t].new + counts[t].changed ? ` (+${changed[t].length - counts[t].new - counts[t].changed} required)` : ''}`);
    console.log(`  users referenced ${users.length} (create-if-missing ${carriedIds.size})`);
    console.log(`Resumes copied: ${copied} → ${resumesOut}`);
}
