/**
 * Import Employee Referral Tracker CSV into Stitch ATS.
 *
 * Creates missing employees / recruiters as `{name}@ats.igsglobal.co` (password: password).
 * Links or creates referred candidates with referredByUserId.
 *
 *   npx tsx src/scripts/import-employee-referrals.ts --csv "C:\path\EmployeeReferralTracker.csv"
 */
import '../../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { DEV_PASSWORD } from '../../config/devUsers.js';
import { findCandidateByEmail } from '../../lib/candidateDuplicate.js';
import { parseLegacyCsv, parseLegacyDate, rowGet, normalizeEmail } from '../../lib/legacyImport/parseCsv.js';
import { nullIfNa } from '../../lib/legacyImport/fieldMap.js';
import { ensureStitchUser, loadStitchUserLookup, } from '../../lib/legacyImport/ensureStitchUser.js';
import { buildCandidateSearchIndexFields } from '../../lib/candidateFieldNormalize.js';
function parseArgs(argv) {
    let csvPath = '';
    let dryRun = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run')
            dryRun = true;
        else if (arg === '--csv')
            csvPath = argv[++i] ?? '';
        else if (arg === '--data-dir') {
            const dir = argv[++i] ?? '';
            const candidate = path.join(dir, 'EmployeeReferralTracker.csv');
            if (fs.existsSync(candidate))
                csvPath = candidate;
        }
    }
    if (!csvPath) {
        throw new Error('Missing --csv <EmployeeReferralTracker.csv> (or --data-dir containing it)');
    }
    const resolved = path.resolve(csvPath);
    if (!fs.existsSync(resolved))
        throw new Error(`CSV not found: ${resolved}`);
    return { csvPath: resolved, dryRun };
}
function mapReferralStatus(row) {
    const outcome = rowGet(row, 'Final Interview outcome').trim().toLowerCase();
    const screening = rowGet(row, 'Screening status-Recruiter').trim().toLowerCase();
    const doj = rowGet(row, 'DOJ');
    if (doj && parseLegacyDate(doj))
        return 'JOINED';
    if (/select|hire|offer/.test(outcome))
        return 'OFFER_ACCEPTED';
    if (/reject|no\s*hire|not\s*select/.test(outcome))
        return 'REJECTED';
    if (/hold/.test(outcome))
        return 'ON_HOLD';
    if (/reject|screen\s*out/.test(screening))
        return 'SCREEN_REJECT';
    if (/shortlist|proceed|select/.test(screening))
        return 'TO_BE_SCREENED';
    return 'TO_BE_SCREENED';
}
export async function run(argv = []) {
    const { csvPath, dryRun } = parseArgs(argv);
    console.log(`Employee referral import${dryRun ? ' (dry-run)' : ''}`);
    console.log(`  CSV: ${csvPath}`);
    const rows = parseLegacyCsv(fs.readFileSync(csvPath, 'utf8'));
    console.log(`  Rows: ${rows.length}`);
    const lookup = dryRun
        ? { byEmail: new Map(), byName: new Map(), emailName: new Map() }
        : await loadStitchUserLookup();
    const passwordHash = dryRun ? 'dry-run' : await bcrypt.hash(DEV_PASSWORD, 10);
    let employeesCreated = 0;
    let recruitersCreated = 0;
    let candidatesCreated = 0;
    let candidatesLinked = 0;
    let skipped = 0;
    for (const row of rows) {
        const refEmail = normalizeEmail(rowGet(row, 'e-mail Id of the reference'));
        const refName = nullIfNa(rowGet(row, 'Name of the reference'));
        if (!refEmail || !refName) {
            skipped++;
            continue;
        }
        const empName = nullIfNa(rowGet(row, 'Employee Name'));
        const empEmail = nullIfNa(rowGet(row, 'Employee e-mail ID'));
        const recruiterName = nullIfNa(rowGet(row, 'Recruiter'));
        const recruiterEmail = nullIfNa(rowGet(row, 'RecruiterEmail'));
        const phone = nullIfNa(rowGet(row, 'Contact number'));
        const position = nullIfNa(rowGet(row, 'Position referred for')) || 'Referral';
        const notesParts = [
            nullIfNa(rowGet(row, 'Comments-ERP Champ')),
            nullIfNa(rowGet(row, 'Approval comments')),
            nullIfNa(rowGet(row, 'Screening Status ERP-Champ')),
            nullIfNa(rowGet(row, 'Screening status-Recruiter')),
        ].filter(Boolean);
        const appliedDate = parseLegacyDate(rowGet(row, 'Created')) ?? new Date();
        const joiningDate = parseLegacyDate(rowGet(row, 'DOJ'));
        let referredByUserId = null;
        if (empName || empEmail) {
            const emp = await ensureStitchUser(lookup, {
                name: empName ?? undefined,
                email: empEmail ?? undefined,
                role: 'EMPLOYEE',
                dryRun,
                passwordHash,
            });
            if (emp) {
                referredByUserId = emp.id;
                if (emp.created) {
                    employeesCreated++;
                    console.log(`  + employee ${empName || empEmail} <${emp.email}>`);
                }
            }
        }
        let createdBy = null;
        if (recruiterName || recruiterEmail) {
            const rec = await ensureStitchUser(lookup, {
                name: recruiterName ?? undefined,
                email: recruiterEmail ?? undefined,
                role: 'RECRUITER',
                dryRun,
                passwordHash,
            });
            if (rec) {
                createdBy = rec.id;
                if (rec.created) {
                    recruitersCreated++;
                    console.log(`  + recruiter ${recruiterName || recruiterEmail} <${rec.email}>`);
                }
            }
        }
        if (dryRun) {
            candidatesCreated++;
            continue;
        }
        const existing = await findCandidateByEmail(refEmail);
        const status = mapReferralStatus(row);
        const searchFields = buildCandidateSearchIndexFields({
            name: refName,
            email: refEmail,
            role: position,
            jobTitle: position,
            location: null,
            currentCompany: null,
            primarySkills: '[]',
            secondarySkills: '[]',
            resumeText: null,
            totalExperience: null,
            currentCTC: null,
            expectedCTC: null,
            noticePeriod: null,
        });
        if (existing) {
            await prisma.candidate.update({
                where: { id: existing.id },
                data: {
                    ...(referredByUserId ? { referredByUserId } : {}),
                    referralRelationship: existing.referralRelationship || 'Employee referral',
                    referralNotes: notesParts.join(' | ') || existing.referralNotes,
                    source: /referral/i.test(existing.source) || existing.source === 'Legacy Import'
                        ? 'Employee Referral'
                        : existing.source,
                    phone: existing.phone || phone,
                    ...(joiningDate ? { joiningDate } : {}),
                    ...(createdBy && !existing.createdBy ? { createdBy } : {}),
                },
            });
            candidatesLinked++;
            if (candidatesLinked <= 15 || candidatesLinked % 100 === 0) {
                console.log(`  ↷ linked referral ${refEmail} ← ${empName || empEmail || '?'}`);
            }
        }
        else {
            await prisma.candidate.create({
                data: {
                    name: refName,
                    email: refEmail,
                    role: position,
                    jobTitle: position,
                    status,
                    source: 'Employee Referral',
                    appliedDate,
                    phone,
                    referredByUserId,
                    referralRelationship: 'Employee referral',
                    referralNotes: notesParts.join(' | ') || null,
                    createdBy,
                    joiningDate,
                    primarySkills: '[]',
                    secondarySkills: '[]',
                    ...searchFields,
                },
            });
            candidatesCreated++;
            if (candidatesCreated <= 15 || candidatesCreated % 50 === 0) {
                console.log(`  ✓ created referral candidate ${refEmail}`);
            }
        }
    }
    console.log('\n=== Referral summary ===');
    console.log(`  employeesCreated: ${employeesCreated}`);
    console.log(`  recruitersCreated: ${recruitersCreated}`);
    console.log(`  candidatesCreated: ${candidatesCreated}`);
    console.log(`  candidatesLinked:  ${candidatesLinked}`);
    console.log(`  skipped:           ${skipped}`);
    if (dryRun)
        console.log('\n(dry-run — no database writes)');
}
