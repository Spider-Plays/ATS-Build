/**
 * Export the legacy-imported hiring data (from the local DB) as one SQL file for the hosted DB.
 *
 *   npm run db:legacy -- export-sql [--out <file.sql>] [--resumes-out <dir>]
 *
 * The SQL runs in one transaction and:
 *   - aborts if the target already has any of these requirements or legacy candidates;
 *   - creates missing recruiter / hiring-manager / vendor users (no password → Microsoft SSO or admin reset);
 *   - maps every user reference by email onto the target's existing users (dev/demo users → first SUPER_ADMIN);
 *   - maps legacy vendors by name onto existing vendors, creating the rest;
 *   - inserts requirements, interview plans, candidates, interviews, feedback, offers, vendor links.
 *
 * Resume files are not in the DB — they are copied to --resumes-out for upload to the server's RESUME_UPLOAD_DIR.
 */
import '../../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { DEV_USERS } from '../../config/devUsers.js';
import { RESUME_UPLOAD_DIR } from '../../lib/resumeStorage.js';
const LEGACY_VENDOR_NOTE = 'Created by legacy Manpower import';
const CARRIED_ROLES = new Set(['RECRUITER', 'HIRING_MANAGER', 'VENDOR']);
/** Scalar user-id columns per table. */
const USER_ID_COLUMNS = {
    Requirement: ['hiringManager', 'createdBy', 'accountManager'],
    Candidate: ['createdBy', 'submittedByUserId', 'referredByUserId'],
    Interview: ['scheduledBy'],
    Feedback: ['interviewerId'],
    Offer: ['createdBy', 'respondedBy'],
    VendorRequirement: ['assignedBy'],
};
/** Text/JSON columns that may embed user ids. */
const USER_ID_TEXT_COLUMNS = {
    Requirement: ['recruiters', 'pendingRecruiters', 'approval', 'approvalHistory', 'versions'],
    InterviewPlanStage: ['defaultInterviewerIds'],
    Interview: ['interviewerIds'],
    Offer: ['approval', 'approvalHistory', 'approvalChainJson', 'history'],
};
function parseArgs(argv) {
    const outDir = path.resolve(process.cwd(), 'data/main-import');
    let out = path.join(outDir, 'legacy-import-live.sql');
    let resumesOut = path.join(outDir, 'resumes-for-server');
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--out')
            out = path.resolve(argv[++i] ?? out);
        else if (argv[i] === '--resumes-out')
            resumesOut = path.resolve(argv[++i] ?? resumesOut);
    }
    return { out, resumesOut };
}
function lit(value) {
    if (value === null || value === undefined)
        return 'NULL';
    if (value instanceof Date)
        return `'${value.toISOString().replace('T', ' ').replace('Z', '')}'`;
    if (typeof value === 'boolean')
        return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number' || typeof value === 'bigint')
        return String(value);
    // Postgres text cannot hold NUL; resume text extracted from PDFs sometimes does.
    return `'${String(value).replace(/\u0000/g, '').replace(/'/g, "''")}'`;
}
function ident(name) {
    return `"${name.replace(/"/g, '""')}"`;
}
async function selectRows(sql, ...params) {
    return (await prisma.$queryRawUnsafe(sql, ...params));
}
function insertStatements(table, rows, batchSize = 200) {
    if (rows.length === 0)
        return [];
    const cols = Object.keys(rows[0]);
    const head = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES`;
    const out = [];
    for (let i = 0; i < rows.length; i += batchSize) {
        const values = rows
            .slice(i, i + batchSize)
            .map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`)
            .join(',\n  ');
        out.push(`${head}\n  ${values};`);
    }
    return out;
}
function collectUserIds(table, rows, into) {
    for (const row of rows) {
        for (const col of USER_ID_COLUMNS[table] ?? []) {
            const v = row[col];
            if (typeof v === 'string' && v)
                into.add(v);
        }
    }
}
export async function run(argv = []) {
    const { out, resumesOut } = parseArgs(argv);
    const requirements = await selectRows(`SELECT * FROM "Requirement" ORDER BY "createdAt"`);
    const reqIds = requirements.map((r) => String(r.id));
    const candidates = await selectRows(`SELECT * FROM "Candidate" ORDER BY "createdAt"`);
    const candIds = candidates.map((c) => String(c.id));
    const plans = await selectRows(`SELECT * FROM "InterviewPlan" WHERE "requirementId" = ANY($1)`, reqIds);
    const planIds = plans.map((p) => String(p.id));
    const stages = await selectRows(`SELECT * FROM "InterviewPlanStage" WHERE "planId" = ANY($1)`, planIds);
    const interviews = await selectRows(`SELECT * FROM "Interview" WHERE "candidateId" = ANY($1)`, candIds);
    const interviewIds = interviews.map((i) => String(i.id));
    const feedback = await selectRows(`SELECT * FROM "Feedback" WHERE "interviewId" = ANY($1)`, interviewIds);
    const offers = await selectRows(`SELECT * FROM "Offer" WHERE "candidateId" = ANY($1)`, candIds);
    const vendors = await selectRows(`SELECT * FROM "Vendor" WHERE notes = $1`, LEGACY_VENDOR_NOTE);
    const vendorIds = vendors.map((v) => String(v.id));
    const vendorLinks = await selectRows(`SELECT * FROM "VendorRequirement" WHERE "requirementId" = ANY($1)`, reqIds);
    const tables = [
        ['Requirement', requirements],
        ['InterviewPlan', plans],
        ['InterviewPlanStage', stages],
        ['Candidate', candidates],
        ['Interview', interviews],
        ['Feedback', feedback],
        ['Offer', offers],
        ['VendorRequirement', vendorLinks],
    ];
    // Users referenced anywhere (scalar columns + ids embedded in JSON text).
    const allUsers = await selectRows(`SELECT * FROM "User"`);
    const referenced = new Set();
    for (const [table, rows] of tables)
        collectUserIds(table, rows, referenced);
    const userIdSet = new Set(allUsers.map((u) => String(u.id)));
    for (const [table, rows] of tables) {
        for (const col of USER_ID_TEXT_COLUMNS[table] ?? []) {
            for (const row of rows) {
                const text = row[col];
                if (typeof text !== 'string')
                    continue;
                for (const m of text.matchAll(/c[a-z0-9]{24}/g))
                    if (userIdSet.has(m[0]))
                        referenced.add(m[0]);
            }
        }
    }
    // Vendor logins for exported vendors travel with them.
    for (const u of allUsers)
        if (u.vendorId && vendorIds.includes(String(u.vendorId)))
            referenced.add(String(u.id));
    const devEmails = new Set(DEV_USERS.map((u) => u.email.toLowerCase()));
    const users = allUsers.filter((u) => referenced.has(String(u.id)));
    const carried = users.filter((u) => CARRIED_ROLES.has(String(u.role)) && !devEmails.has(String(u.email).toLowerCase()));
    const carriedIds = new Set(carried.map((u) => String(u.id)));
    const sql = [];
    const sourceDb = (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@');
    sql.push(`-- Legacy SharePoint import → hosted ATS`, `-- Generated ${new Date().toISOString()} from ${sourceDb}`, `-- ${requirements.length} requirements, ${candidates.length} candidates, ${interviews.length} interviews, ` +
        `${feedback.length} feedback, ${offers.length} offers, ${vendors.length} vendors, ${carried.length} users to create if missing.`, `-- Run once:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f legacy-import-live.sql`, `-- Everything runs in one transaction; any error rolls the whole import back.`, '', 'BEGIN;', '');
    // Guard: never double-import.
    const jobCodes = requirements.map((r) => r.jobCode).filter(Boolean);
    sql.push(`DO $$`, `BEGIN`, `  IF EXISTS (SELECT 1 FROM "Requirement" WHERE "jobCode" = ANY(ARRAY[${jobCodes.map(lit).join(', ')}]::text[])) THEN`, `    RAISE EXCEPTION 'Target already has some of these requirements (jobCode). Aborting legacy import.';`, `  END IF;`, `  IF EXISTS (SELECT 1 FROM "Candidate" WHERE "legacyResumeId" IS NOT NULL) THEN`, `    RAISE EXCEPTION 'Target already has legacy-imported candidates. Aborting legacy import.';`, `  END IF;`, `  IF NOT EXISTS (SELECT 1 FROM "User" WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE') THEN`, `    RAISE EXCEPTION 'Target has no active SUPER_ADMIN to own unmapped records. Aborting.';`, `  END IF;`, `END $$;`, '');
    // Vendors: reuse by name, else create.
    sql.push(`-- Vendors (matched by name, created if missing)`);
    sql.push(`CREATE TEMP TABLE _legacy_vendor_map (old_id text PRIMARY KEY, name text NOT NULL, new_id text) ON COMMIT DROP;`);
    for (const v of vendors) {
        sql.push(`INSERT INTO _legacy_vendor_map (old_id, name) VALUES (${lit(v.id)}, ${lit(v.name)});`);
        const cols = Object.keys(v);
        sql.push(`INSERT INTO "Vendor" (${cols.map(ident).join(', ')}) SELECT ${cols.map((c) => lit(v[c])).join(', ')}` +
            ` WHERE NOT EXISTS (SELECT 1 FROM "Vendor" WHERE lower(name) = lower(${lit(v.name)}))` +
            ` AND NOT EXISTS (SELECT 1 FROM "Vendor" WHERE code = ${lit(v.code)});`);
    }
    sql.push(`UPDATE _legacy_vendor_map m SET new_id = COALESCE(`, `  (SELECT id FROM "Vendor" v WHERE lower(v.name) = lower(m.name) ORDER BY v."createdAt" LIMIT 1),`, `  (SELECT id FROM "Vendor" v WHERE v.id = m.old_id));`, `DO $$ BEGIN IF EXISTS (SELECT 1 FROM _legacy_vendor_map WHERE new_id IS NULL) THEN`, `  RAISE EXCEPTION 'Could not create or match a legacy vendor (code clash?). Aborting.'; END IF; END $$;`, '');
    // Users: create carried ones if missing (no password), map every referenced id by email.
    sql.push(`-- Users (matched by email; recruiters / hiring managers / vendor logins created if missing, without a password)`);
    sql.push(`CREATE TEMP TABLE _legacy_user_map (old_id text PRIMARY KEY, email text NOT NULL, new_id text) ON COMMIT DROP;`);
    for (const u of users) {
        sql.push(`INSERT INTO _legacy_user_map (old_id, email) VALUES (${lit(u.id)}, ${lit(u.email)});`);
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
            ` WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE lower(email) = lower(${lit(u.email)}))` +
            ` AND NOT EXISTS (SELECT 1 FROM "User" WHERE id = ${lit(u.id)});`);
    }
    sql.push(`UPDATE _legacy_user_map m SET new_id = COALESCE(`, `  (SELECT id FROM "User" u WHERE lower(u.email) = lower(m.email) LIMIT 1),`, `  (SELECT id FROM "User" WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' ORDER BY "createdAt" LIMIT 1));`, `-- Vendor logins point at the (possibly pre-existing) vendor row.`, `UPDATE "User" u SET "vendorId" = m.new_id FROM _legacy_vendor_map m`, `  WHERE u."vendorId" = m.old_id AND u.id IN (SELECT new_id FROM _legacy_user_map);`, '');
    // Data rows, keeping local ids (plan stages FK the plan; interviews FK the stage).
    for (const [table, rows] of tables) {
        sql.push(`-- ${table}: ${rows.length} row(s)`);
        sql.push(...insertStatements(table, rows));
        sql.push('');
    }
    // Re-point user and vendor references at the target's ids.
    const exportedIds = (rows) => `ARRAY[${rows.map((r) => lit(r.id)).join(', ')}]::text[]`;
    sql.push(`-- Remap user ids (scalar columns + ids embedded in JSON text)`);
    sql.push(`CREATE TEMP TABLE _legacy_rows (tbl text, id text) ON COMMIT DROP;`);
    for (const [table, rows] of tables) {
        if (!USER_ID_COLUMNS[table] && !USER_ID_TEXT_COLUMNS[table])
            continue;
        if (rows.length === 0)
            continue;
        sql.push(`INSERT INTO _legacy_rows SELECT ${lit(table)}, unnest(${exportedIds(rows)});`);
    }
    sql.push(`DO $$`, `DECLARE m record;`, `BEGIN`, `  FOR m IN SELECT old_id, new_id FROM _legacy_user_map WHERE new_id IS DISTINCT FROM old_id LOOP`);
    for (const [table, cols] of Object.entries(USER_ID_COLUMNS)) {
        for (const col of cols) {
            sql.push(`    UPDATE ${ident(table)} SET ${ident(col)} = m.new_id WHERE ${ident(col)} = m.old_id` +
                ` AND id IN (SELECT id FROM _legacy_rows WHERE tbl = ${lit(table)});`);
        }
    }
    for (const [table, cols] of Object.entries(USER_ID_TEXT_COLUMNS)) {
        for (const col of cols) {
            sql.push(`    UPDATE ${ident(table)} SET ${ident(col)} = replace(${ident(col)}, m.old_id, m.new_id)` +
                ` WHERE strpos(${ident(col)}, m.old_id) > 0 AND id IN (SELECT id FROM _legacy_rows WHERE tbl = ${lit(table)});`);
        }
    }
    sql.push(`  END LOOP;`, `END $$;`, '');
    sql.push(`-- Remap vendor ids`, `UPDATE "Candidate" c SET "vendorId" = m.new_id FROM _legacy_vendor_map m`, `  WHERE c."vendorId" = m.old_id AND m.new_id IS DISTINCT FROM m.old_id AND c.id = ANY(${exportedIds(candidates)});`, `UPDATE "VendorRequirement" r SET "vendorId" = m.new_id FROM _legacy_vendor_map m`, `  WHERE r."vendorId" = m.old_id AND m.new_id IS DISTINCT FROM m.old_id AND r.id = ANY(${exportedIds(vendorLinks)});`, '', `-- Summary (visible in psql output)`, `SELECT 'requirements' AS what, count(*) FROM "Requirement" WHERE id = ANY(${exportedIds(requirements)})`, `UNION ALL SELECT 'candidates', count(*) FROM "Candidate" WHERE "legacyResumeId" IS NOT NULL OR id = ANY(${exportedIds(candidates)})`, `UNION ALL SELECT 'users mapped', count(*) FROM _legacy_user_map`, `UNION ALL SELECT 'vendors mapped', count(*) FROM _legacy_vendor_map;`, '', 'COMMIT;', '');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, sql.join('\n'), 'utf8');
    const sizeMb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
    // Resume files, named <candidateId>.<ext> as the server expects.
    fs.mkdirSync(resumesOut, { recursive: true });
    const wanted = new Set(candidates.filter((c) => c.resumeFileName).map((c) => String(c.id)));
    let copied = 0;
    for (const name of fs.readdirSync(RESUME_UPLOAD_DIR)) {
        const id = name.replace(/\.[^.]+$/, '');
        if (!wanted.has(id))
            continue;
        fs.copyFileSync(path.join(RESUME_UPLOAD_DIR, name), path.join(resumesOut, name));
        copied++;
    }
    console.log(`SQL written: ${out} (${sizeMb} MB)`);
    console.log(`  requirements ${requirements.length}, candidates ${candidates.length}, interviews ${interviews.length}, ` +
        `feedback ${feedback.length}, offers ${offers.length}, vendors ${vendors.length}, vendor links ${vendorLinks.length}`);
    console.log(`  users referenced ${users.length} (create-if-missing ${carried.length}, others mapped by email / SUPER_ADMIN)`);
    console.log(`Resumes copied: ${copied}/${wanted.size} → ${resumesOut}`);
}
