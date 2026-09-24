/**
 * Keep only the SharePoint Recruiter choices (+ Alankar) as RECRUITER users.
 * Everyone else's candidates move under Employee Referral; those users become EMPLOYEE.
 *
 *   npm run db:legacy -- prune-recruiters --dry-run
 *   npm run db:legacy -- prune-recruiters
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { ALLOWED_RECRUITER_NAMES, EMPLOYEE_REFERRAL_NAME, EMPLOYEE_REFERRAL_SOURCE, isAllowedRecruiterName, resolveAllowedRecruiterName, } from '../../lib/legacyImport/allowedRecruiters.js';
import { isProtectedStitchEmail, normalizePersonName, personNameTokens, stitchEmailFromName, } from '../../lib/legacyImport/ensureStitchUser.js';
import { refuseProductionUnlessForced, targetDbLabel } from '../reset/safety.js';
function parseArgs(argv) {
    return { dryRun: argv.includes('--dry-run') };
}
function removeIdFromJsonArray(raw, removeId) {
    if (raw == null)
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return raw;
        const next = parsed.filter((v) => String(v) !== removeId);
        return JSON.stringify(next) === raw ? raw : JSON.stringify(next);
    }
    catch {
        return raw;
    }
}
const DO_NOT_PROMOTE = new Set([
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
    'FINANCE_HEAD',
]);
function pickPromoteCandidate(matches) {
    const eligible = matches.filter((u) => !DO_NOT_PROMOTE.has(u.role));
    if (eligible.length === 0)
        return null;
    return [...eligible].sort((a, b) => {
        const aRec = a.role === 'RECRUITER' ? 1 : 0;
        const bRec = b.role === 'RECRUITER' ? 1 : 0;
        if (bRec !== aRec)
            return bRec - aRec;
        const aExact = ALLOWED_RECRUITER_NAMES.some((n) => normalizePersonName(n).toLowerCase() === normalizePersonName(a.name).toLowerCase())
            ? 1
            : 0;
        const bExact = ALLOWED_RECRUITER_NAMES.some((n) => normalizePersonName(n).toLowerCase() === normalizePersonName(b.name).toLowerCase())
            ? 1
            : 0;
        if (bExact !== aExact)
            return bExact - aExact;
        return personNameTokens(b.name).length - personNameTokens(a.name).length;
    })[0];
}
export async function run(argv = []) {
    const { dryRun } = parseArgs(argv);
    refuseProductionUnlessForced(argv, 'prune-recruiters');
    console.log(`Prune recruiters → keep allowed + Alankar${dryRun ? ' (dry-run)' : ''}`);
    console.log(`Target DB: ${targetDbLabel()}`);
    let referral = await prisma.user.findFirst({
        where: {
            OR: [
                { name: { equals: EMPLOYEE_REFERRAL_NAME, mode: 'insensitive' } },
                { email: stitchEmailFromName(EMPLOYEE_REFERRAL_NAME) },
                { email: 'employee.referral@ats.igsglobal.co' },
            ],
        },
        select: { id: true, name: true, email: true, role: true },
    });
    if (!referral) {
        console.log(`  Creating missing "${EMPLOYEE_REFERRAL_NAME}" user…`);
        if (!dryRun) {
            const bcrypt = await import('bcryptjs');
            const { DEV_PASSWORD } = await import('../../config/devUsers.js');
            referral = await prisma.user.create({
                data: {
                    email: stitchEmailFromName(EMPLOYEE_REFERRAL_NAME),
                    passwordHash: await bcrypt.hash(DEV_PASSWORD, 10),
                    name: EMPLOYEE_REFERRAL_NAME,
                    role: 'RECRUITER',
                    department: 'Talent Acquisition',
                    status: 'ACTIVE',
                    permissions: '[]',
                    themePreference: 'light',
                    authProvider: 'local',
                    mustChangePassword: false,
                },
                select: { id: true, name: true, email: true, role: true },
            });
        }
        else {
            referral = {
                id: 'dry-run-employee-referral',
                name: EMPLOYEE_REFERRAL_NAME,
                email: stitchEmailFromName(EMPLOYEE_REFERRAL_NAME),
                role: 'RECRUITER',
            };
        }
    }
    const allUsers = await prisma.user.findMany({
        select: { id: true, name: true, email: true, status: true, role: true },
        orderBy: { name: 'asc' },
    });
    const byAllowed = new Map();
    for (const u of allUsers) {
        const resolved = resolveAllowedRecruiterName(u.name);
        if (!resolved || resolved === EMPLOYEE_REFERRAL_NAME)
            continue;
        const list = byAllowed.get(resolved) ?? [];
        list.push(u);
        byAllowed.set(resolved, list);
    }
    console.log(`\nPromote allowed names to RECRUITER if needed:`);
    let promoted = 0;
    for (const [canonical, matches] of [...byAllowed.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const pick = pickPromoteCandidate(matches);
        if (!pick) {
            console.log(`  ⚠ no promotable user for ${canonical}`);
            continue;
        }
        if (pick.role === 'RECRUITER') {
            console.log(`  ✓ already RECRUITER: ${pick.name} <${pick.email}>`);
            continue;
        }
        console.log(`  ↑ ${pick.name} <${pick.email}> [${pick.role}] → RECRUITER (${canonical})`);
        promoted++;
        if (!dryRun) {
            await prisma.user.update({
                where: { id: pick.id },
                data: { role: 'RECRUITER', department: 'Talent Acquisition' },
            });
        }
    }
    const liveRecruiters = await prisma.user.findMany({
        where: { role: 'RECRUITER' },
        select: { id: true, name: true, email: true, status: true, role: true },
        orderBy: { name: 'asc' },
    });
    const recruiterRows = [...liveRecruiters];
    if (dryRun) {
        for (const matches of byAllowed.values()) {
            const pick = pickPromoteCandidate(matches);
            if (pick && pick.role !== 'RECRUITER')
                recruiterRows.push(pick);
        }
    }
    const seen = new Set();
    const uniqueRecruiters = [];
    for (const u of recruiterRows) {
        if (seen.has(u.id))
            continue;
        seen.add(u.id);
        uniqueRecruiters.push(u);
    }
    const keepers = [];
    const prune = [];
    for (const u of uniqueRecruiters) {
        if (u.id === referral.id || isAllowedRecruiterName(u.name)) {
            keepers.push(u);
            continue;
        }
        if (isProtectedStitchEmail(u.email)) {
            console.log(`  keep protected seed recruiter: ${u.name} <${u.email}>`);
            keepers.push(u);
            continue;
        }
        prune.push(u);
    }
    console.log(`\nKeep (${keepers.length}):`);
    for (const u of keepers) {
        console.log(`  ✓ ${u.name} <${u.email}> [${u.role}]`);
    }
    console.log(`\nPrune → EMPLOYEE + candidates → ${EMPLOYEE_REFERRAL_NAME} (${prune.length}):`);
    let candidatesMoved = 0;
    let reqsUpdated = 0;
    for (const u of prune) {
        const candCount = await prisma.candidate.count({ where: { createdBy: u.id } });
        const reqCount = await prisma.requirement.count({ where: { recruiters: { contains: u.id } } });
        console.log(`  - ${u.name} <${u.email}> candidates=${candCount} reqs=${reqCount}`);
        if (!dryRun) {
            const moved = await prisma.candidate.updateMany({
                where: { createdBy: u.id },
                data: {
                    createdBy: referral.id,
                    source: EMPLOYEE_REFERRAL_SOURCE,
                    referredByUserId: u.id,
                },
            });
            candidatesMoved += moved.count;
            const reqs = await prisma.requirement.findMany({
                where: { recruiters: { contains: u.id } },
                select: { id: true, recruiters: true },
            });
            for (const r of reqs) {
                const next = removeIdFromJsonArray(r.recruiters, u.id);
                if (next == null || next === r.recruiters)
                    continue;
                await prisma.requirement.update({
                    where: { id: r.id },
                    data: { recruiters: next },
                });
                reqsUpdated++;
            }
            await prisma.user.update({
                where: { id: u.id },
                data: {
                    role: 'EMPLOYEE',
                    department: 'Employee',
                    name: normalizePersonName(u.name),
                },
            });
        }
        else {
            candidatesMoved += candCount;
            reqsUpdated += reqCount;
        }
    }
    if (!dryRun) {
        for (const u of keepers) {
            if (u.role !== 'RECRUITER') {
                await prisma.user.update({
                    where: { id: u.id },
                    data: { role: 'RECRUITER', department: 'Talent Acquisition' },
                });
            }
        }
        if (referral.role !== 'RECRUITER') {
            await prisma.user.update({
                where: { id: referral.id },
                data: { role: 'RECRUITER', name: EMPLOYEE_REFERRAL_NAME },
            });
        }
    }
    console.log(`\nSummary:`);
    console.log(`  promoted to RECRUITER: ${promoted}`);
    console.log(`  candidates → ${EMPLOYEE_REFERRAL_NAME}: ${candidatesMoved}`);
    console.log(`  requirement recruiter slots cleared: ${reqsUpdated}`);
    console.log(`  users demoted to EMPLOYEE: ${prune.length}`);
    if (dryRun)
        console.log('\n(dry-run — no database writes)');
}
