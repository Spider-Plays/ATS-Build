/**
 * Export interviews + interview feedback as one SQL file, for a hosted DB that already
 * received the main legacy import (same candidate / requirement / plan-stage ids).
 *
 *   npm run db:legacy -- export-feedback-sql [--out <file.sql>]
 *
 * The SQL runs in one transaction and:
 *   - aborts unless the target already has the candidates these interviews belong to;
 *   - creates missing interviewer / hiring-manager / recruiter users (no password) and maps all user ids by email
 *     (dev/demo users → the target's first active SUPER_ADMIN);
 *   - upserts interviews and feedback by id: new rows are inserted, existing rows get the latest values.
 */
import '../../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { isProtectedStitchEmail } from '../../lib/legacyImport/ensureStitchUser.js';
import { ident, lit } from './exportSql.js';
const CARRIED_ROLES = new Set(['RECRUITER', 'HIRING_MANAGER', 'VENDOR', 'INTERVIEWER']);
function upsertStatements(table, rows, batchSize = 200) {
    if (rows.length === 0)
        return [];
    const cols = Object.keys(rows[0]);
    const updates = cols.filter((c) => c !== 'id').map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ');
    const out = [];
    for (let i = 0; i < rows.length; i += batchSize) {
        const values = rows
            .slice(i, i + batchSize)
            .map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`)
            .join(',\n  ');
        out.push(`INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES\n  ${values}\n` +
            `ON CONFLICT (id) DO UPDATE SET ${updates};`);
    }
    return out;
}
export async function run(argv = []) {
    const outArg = argv.indexOf('--out');
    const out = outArg >= 0 && argv[outArg + 1]
        ? path.resolve(argv[outArg + 1])
        : path.resolve(process.cwd(), 'data/main-import/feedback-import-live.sql');
    const interviews = (await prisma.$queryRawUnsafe(`SELECT * FROM "Interview" ORDER BY "createdAt"`));
    const feedback = (await prisma.$queryRawUnsafe(`SELECT * FROM "Feedback" ORDER BY "createdAt"`));
    const candidateIds = [...new Set(interviews.map((i) => String(i.candidateId)))];
    const stageIds = [...new Set(interviews.map((i) => i.planStageId).filter(Boolean).map(String))];
    // Users referenced by interviews / feedback.
    const allUsers = (await prisma.$queryRawUnsafe(`SELECT * FROM "User"`));
    const userIds = new Set(allUsers.map((u) => String(u.id)));
    const referenced = new Set();
    for (const i of interviews) {
        if (i.scheduledBy)
            referenced.add(String(i.scheduledBy));
        for (const m of String(i.interviewerIds ?? '').matchAll(/c[a-z0-9]{24}/g))
            if (userIds.has(m[0]))
                referenced.add(m[0]);
    }
    for (const f of feedback)
        if (f.interviewerId)
            referenced.add(String(f.interviewerId));
    const users = allUsers.filter((u) => referenced.has(String(u.id)));
    const carried = users.filter((u) => CARRIED_ROLES.has(String(u.role)) && !isProtectedStitchEmail(String(u.email)));
    const carriedIds = new Set(carried.map((u) => String(u.id)));
    const idArray = (ids) => `ARRAY[${ids.map(lit).join(', ')}]::text[]`;
    const sql = [];
    const sourceDb = (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@');
    sql.push(`-- Interview feedback → hosted ATS (run AFTER legacy-import-live.sql)`, `-- Generated ${new Date().toISOString()} from ${sourceDb}`, `-- ${interviews.length} interviews, ${feedback.length} feedback, ${carried.length} users to create if missing.`, `-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f feedback-import-live.sql`, `-- One transaction; safe to re-run (rows are upserted by id).`, '', 'BEGIN;', '', `DO $$`, `DECLARE missing int;`, `BEGIN`, `  SELECT count(*) INTO missing FROM unnest(${idArray(candidateIds)}) AS c(id)`, `    WHERE NOT EXISTS (SELECT 1 FROM "Candidate" x WHERE x.id = c.id);`, `  IF missing > 0 THEN`, `    RAISE EXCEPTION '% candidate(s) for these interviews are not on this database. Run legacy-import-live.sql first.', missing;`, `  END IF;`, `  SELECT count(*) INTO missing FROM unnest(${idArray(stageIds)}) AS s(id)`, `    WHERE NOT EXISTS (SELECT 1 FROM "InterviewPlanStage" x WHERE x.id = s.id);`, `  IF missing > 0 THEN`, `    RAISE EXCEPTION '% interview plan stage(s) are missing. Run legacy-import-live.sql first.', missing;`, `  END IF;`, `  IF NOT EXISTS (SELECT 1 FROM "User" WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE') THEN`, `    RAISE EXCEPTION 'Target has no active SUPER_ADMIN to own unmapped records. Aborting.';`, `  END IF;`, `END $$;`, '');
    sql.push(`-- Users (matched by email; interviewers etc. created if missing, without a password)`);
    sql.push(`CREATE TEMP TABLE _fb_user_map (old_id text PRIMARY KEY, email text NOT NULL, new_id text) ON COMMIT DROP;`);
    for (const u of users) {
        sql.push(`INSERT INTO _fb_user_map (old_id, email) VALUES (${lit(u.id)}, ${lit(u.email)});`);
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
            vendorId: null,
        };
        const cols = Object.keys(row);
        sql.push(`INSERT INTO "User" (${cols.map(ident).join(', ')}) SELECT ${cols.map((c) => lit(row[c])).join(', ')}` +
            ` WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE lower(email) = lower(${lit(u.email)}))` +
            ` AND NOT EXISTS (SELECT 1 FROM "User" WHERE id = ${lit(u.id)});`);
    }
    sql.push(`UPDATE _fb_user_map m SET new_id = COALESCE(`, `  (SELECT id FROM "User" u WHERE lower(u.email) = lower(m.email) LIMIT 1),`, `  (SELECT id FROM "User" WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' ORDER BY "createdAt" LIMIT 1));`, '');
    sql.push(`-- Interviews: ${interviews.length} row(s)`, ...upsertStatements('Interview', interviews), '');
    sql.push(`-- Feedback: ${feedback.length} row(s)`, ...upsertStatements('Feedback', feedback), '');
    const interviewIds = interviews.map((i) => String(i.id));
    const feedbackIds = feedback.map((f) => String(f.id));
    sql.push(`-- Remap user ids onto this database's users`, `DO $$`, `DECLARE m record;`, `BEGIN`, `  FOR m IN SELECT old_id, new_id FROM _fb_user_map WHERE new_id IS DISTINCT FROM old_id LOOP`, `    UPDATE "Interview" SET "scheduledBy" = m.new_id WHERE "scheduledBy" = m.old_id AND id = ANY(${idArray(interviewIds)});`, `    UPDATE "Interview" SET "interviewerIds" = replace("interviewerIds", m.old_id, m.new_id)`, `      WHERE strpos("interviewerIds", m.old_id) > 0 AND id = ANY(${idArray(interviewIds)});`, `    UPDATE "Feedback" SET "interviewerId" = m.new_id WHERE "interviewerId" = m.old_id AND id = ANY(${idArray(feedbackIds)});`, `  END LOOP;`, `END $$;`, '', `SELECT 'interviews' AS what, count(*) FROM "Interview" WHERE id = ANY(${idArray(interviewIds)})`, `UNION ALL SELECT 'feedback', count(*) FROM "Feedback" WHERE id = ANY(${idArray(feedbackIds)})`, `UNION ALL SELECT 'users mapped', count(*) FROM _fb_user_map;`, '', 'COMMIT;', '');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, sql.join('\n'), 'utf8');
    console.log(`SQL written: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`  interviews ${interviews.length}, feedback ${feedback.length}`);
    console.log(`  users referenced ${users.length} (create-if-missing ${carried.length}, others mapped by email / SUPER_ADMIN)`);
}
