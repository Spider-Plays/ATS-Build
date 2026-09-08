import '../../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { DEV_PASSWORD } from '../../config/devUsers.js';
import { serializeSkills, parseSkillList } from '../../lib/skills.js';
import { ensureInterviewPlan } from '../../lib/interviewPlan.js';
import { findCandidateByEmail } from '../../lib/candidateDuplicate.js';
import { saveResumeFile } from '../../lib/resumeStorage.js';
import { buildCandidateResumePayload, extractResumeText, } from '../../lib/resumeParse.js';
import { buildCandidateSearchIndexFields } from '../../lib/candidateFieldNormalize.js';
import { buildOfferCreateData } from '../../lib/offerActions.js';
import { normalizePersonName, slugFromName, stitchEmailFromName, } from '../../lib/legacyImport/ensureStitchUser.js';
import { EMPLOYEE_REFERRAL_NAME, EMPLOYEE_REFERRAL_SOURCE, isAllowedRecruiterName, } from '../../lib/legacyImport/allowedRecruiters.js';
import { buildImportStats, dedupeRowsByEmail, findResumeFile, loadLegacyCsv, loadLegacyRequirementCsv, normalizeEmail, parseCtcLakhs, parseLegacyDate, rowGet, } from '../../lib/legacyImport/parseCsv.js';
import { createEmptyManifest, defaultManifestPath, loadManifest, saveManifest, } from '../../lib/legacyImport/manifest.js';
import { extractInterviewSlots, interviewRecordStatus, legacyFeedbackRecommendation, mapLegacyStatus, pipelineRank, } from '../../lib/legacyImport/statusMap.js';
import { buildImportReportRows, writeLegacyImportWorkbook, } from '../../lib/legacyImport/writeImportReport.js';
import { buildManpowerRequirementPayload, isChildRequirement, nullIfNa, sourceMonthFromDate, sourceWeekFromDate, } from '../../lib/legacyImport/fieldMap.js';
function parseArgs(argv) {
    let dataDir = '';
    let dryRun = false;
    let skipResumes = false;
    let forceResume = false;
    let createdBy = null;
    let manifestPath = '';
    let onlyRequirements = false;
    let resumesOnly = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run')
            dryRun = true;
        else if (arg === '--skip-resumes')
            skipResumes = true;
        else if (arg === '--force-resume')
            forceResume = true;
        else if (arg === '--only-requirements')
            onlyRequirements = true;
        else if (arg === '--resumes-only')
            resumesOnly = true;
        else if (arg === '--data-dir')
            dataDir = argv[++i] ?? '';
        else if (arg === '--created-by')
            createdBy = argv[++i] ?? null;
        else if (arg === '--manifest')
            manifestPath = argv[++i] ?? '';
    }
    if (!dataDir) {
        throw new Error('Missing --data-dir <path to extracted data/ folder>');
    }
    if (onlyRequirements && resumesOnly) {
        throw new Error('Use either --only-requirements or --resumes-only, not both');
    }
    const resolved = path.resolve(dataDir);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Data directory not found: ${resolved}`);
    }
    return {
        dataDir: resolved,
        dryRun,
        skipResumes,
        forceResume,
        createdBy,
        onlyRequirements,
        resumesOnly,
        manifestPath: manifestPath || defaultManifestPath(resolved),
    };
}
async function resolveFallbackUserId(explicit) {
    if (explicit) {
        const user = await prisma.user.findUnique({ where: { id: explicit } });
        if (!user)
            throw new Error(`--created-by user not found: ${explicit}`);
        return user.id;
    }
    const admin = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
    });
    if (!admin) {
        throw new Error('No SUPER_ADMIN user found. Pass --created-by <userId>.');
    }
    return admin.id;
}
function isPlaceholderValue(raw) {
    return !raw.trim() || /^(na|n\/a|nil|null|-|none)$/i.test(raw.trim());
}
function splitPeopleParts(raw) {
    return raw
        .split(/[;,|]/)
        .map((p) => p.trim())
        .filter((p) => p && !isPlaceholderValue(p));
}
function hiringManagerEmailFromName(name) {
    return stitchEmailFromName(normalizePersonName(name));
}
function createEmptyLookup() {
    return { byEmail: new Map(), byName: new Map(), emailName: new Map() };
}
function registerUserInLookup(lookup, user, aliasNames = []) {
    const email = user.email.toLowerCase();
    lookup.byEmail.set(email, user.id);
    lookup.emailName.set(email, user.name.trim().toLowerCase());
    const nameKey = user.name.trim().toLowerCase();
    if (nameKey)
        lookup.byName.set(nameKey, user.id);
    for (const alias of aliasNames) {
        const a = alias.trim().toLowerCase();
        if (a)
            lookup.byName.set(a, user.id);
    }
}
async function buildUserLookup() {
    const users = await prisma.user.findMany({
        select: { id: true, email: true, name: true },
    });
    const lookup = createEmptyLookup();
    for (const u of users)
        registerUserInLookup(lookup, u);
    return lookup;
}
function resolveUserIdByEmail(lookup, email) {
    const v = email?.trim().toLowerCase();
    if (!v || !v.includes('@') || isPlaceholderValue(v))
        return null;
    return lookup.byEmail.get(v) ?? null;
}
/** Exact name match only — "Sachin" and "Sachin S" stay distinct. */
function resolveUserIdByName(lookup, name) {
    const v = name?.trim();
    if (!v || isPlaceholderValue(v))
        return null;
    const exact = lookup.byName.get(v.toLowerCase()) ??
        lookup.byName.get(normalizePersonName(v).toLowerCase()) ??
        null;
    if (exact)
        return exact;
    // Prefer a longer registered full name that this short name prefixes
    // e.g. "Pooja" → "Pooja M C", "Pravin Christo" → "Pravin Christo peter Selvaraj".
    const tokens = normalizePersonName(v)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (tokens.length === 0)
        return null;
    let bestId = null;
    let bestLen = tokens.length;
    for (const [registeredName, id] of lookup.byName) {
        if (/&|\band\b/i.test(registeredName))
            continue;
        const regTokens = registeredName
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (regTokens.length <= tokens.length)
            continue;
        if (!tokens.every((t, i) => t === regTokens[i]))
            continue;
        if (regTokens.length > bestLen) {
            bestLen = regTokens.length;
            bestId = id;
        }
    }
    return bestId;
}
function resolveUserId(lookup, ...candidates) {
    for (const raw of candidates) {
        const v = raw?.trim();
        if (!v || isPlaceholderValue(v))
            continue;
        if (v.includes('@')) {
            const id = resolveUserIdByEmail(lookup, v);
            if (id)
                return id;
            continue;
        }
        const id = resolveUserIdByName(lookup, v);
        if (id)
            return id;
    }
    return null;
}
function namesMatch(a, b) {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}
async function ensureRecruiterUser(lookup, passwordHash, identity, dryRun) {
    const name = identity.name?.trim();
    // Sheet emails are ignored for login — all import users use @stitch-ats.in.
    // Keep optional email only as a soft hint (unused for create).
    if (!name || isPlaceholderValue(name))
        return null;
    const byName = resolveUserIdByName(lookup, name);
    if (byName) {
        lookup.byName.set(name.toLowerCase(), byName);
        lookup.byName.set(normalizePersonName(name).toLowerCase(), byName);
        return { id: byName, created: false };
    }
    const displayName = normalizePersonName(name);
    let finalEmail = `${slugFromName(displayName)}@stitch-ats.in`;
    if (resolveUserIdByEmail(lookup, finalEmail)) {
        finalEmail = `${slugFromName(displayName)}.${crypto.randomBytes(2).toString('hex')}@stitch-ats.in`;
    }
    if (dryRun) {
        const dryId = `dry-run-user-${finalEmail}`;
        registerUserInLookup(lookup, { id: dryId, email: finalEmail, name: displayName }, [name]);
        return { id: dryId, created: true };
    }
    const existingByEmail = await prisma.user.findUnique({
        where: { email: finalEmail },
        select: { id: true, email: true, name: true },
    });
    if (existingByEmail) {
        registerUserInLookup(lookup, existingByEmail, [name, displayName]);
        if (namesMatch(existingByEmail.name, displayName) || isShorterFormName(name, existingByEmail.name)) {
            lookup.byName.set(name.toLowerCase(), existingByEmail.id);
            return { id: existingByEmail.id, created: false };
        }
        if (isShorterFormName(existingByEmail.name, displayName)) {
            // Upgrade short-name account to the full display name + stitch email.
            await prisma.user.update({
                where: { id: existingByEmail.id },
                data: { name: displayName, email: finalEmail },
            });
            registerUserInLookup(lookup, { id: existingByEmail.id, email: finalEmail, name: displayName }, [
                name,
                displayName,
            ]);
            return { id: existingByEmail.id, created: false };
        }
        finalEmail = `${slugFromName(displayName)}.${crypto.randomBytes(2).toString('hex')}@stitch-ats.in`;
    }
    const created = await prisma.user.create({
        data: {
            email: finalEmail,
            passwordHash,
            name: displayName,
            role: 'RECRUITER',
            department: 'Talent Acquisition',
            status: 'ACTIVE',
            permissions: '[]',
            themePreference: 'light',
            authProvider: 'local',
            mustChangePassword: false,
        },
        select: { id: true, email: true, name: true },
    });
    registerUserInLookup(lookup, created, [name, displayName]);
    return { id: created.id, created: true };
}
function isShorterFormName(short, full) {
    if (/&|\band\b/i.test(full))
        return false;
    const a = normalizePersonName(short)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const b = normalizePersonName(full)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (a.length === 0 || a.length >= b.length)
        return false;
    if (a.every((t) => t.length < 2))
        return false;
    return a.every((t, i) => t === b[i]);
}
async function ensureHiringManagerUser(lookup, passwordHash, rawName, dryRun) {
    const name = normalizePersonName(rawName);
    if (!name || isPlaceholderValue(name))
        return null;
    const byName = resolveUserIdByName(lookup, name) ?? resolveUserIdByName(lookup, rawName);
    if (byName) {
        lookup.byName.set(rawName.trim().toLowerCase(), byName);
        lookup.byName.set(name.toLowerCase(), byName);
        return { id: byName, created: false };
    }
    let finalEmail = hiringManagerEmailFromName(name);
    if (resolveUserIdByEmail(lookup, finalEmail)) {
        // Email taken by a different person — keep a unique stitch-ats.in address.
        finalEmail = `${slugFromName(name)}.${crypto.randomBytes(2).toString('hex')}@stitch-ats.in`;
    }
    if (dryRun) {
        const dryId = `dry-run-hm-${finalEmail}`;
        registerUserInLookup(lookup, { id: dryId, email: finalEmail, name }, [rawName, name]);
        return { id: dryId, created: true };
    }
    const existingByEmail = await prisma.user.findUnique({
        where: { email: finalEmail },
        select: { id: true, email: true, name: true, role: true },
    });
    if (existingByEmail) {
        registerUserInLookup(lookup, existingByEmail, [rawName, name]);
        if (namesMatch(existingByEmail.name, name)) {
            return { id: existingByEmail.id, created: false };
        }
        finalEmail = `${slugFromName(name)}.${crypto.randomBytes(2).toString('hex')}@stitch-ats.in`;
    }
    const created = await prisma.user.create({
        data: {
            email: finalEmail,
            passwordHash,
            name,
            role: 'HIRING_MANAGER',
            department: 'Engineering',
            status: 'ACTIVE',
            permissions: '[]',
            themePreference: 'light',
            authProvider: 'local',
            mustChangePassword: false,
        },
        select: { id: true, email: true, name: true },
    });
    registerUserInLookup(lookup, created, [rawName, name]);
    return { id: created.id, created: true };
}
/**
 * Ensure every Manpower "Hiring Manager" exists as a HIRING_MANAGER user.
 * Missing users get `{name-slug}@stitch-ats.in`.
 */
async function ensureLegacyHiringManagers(requirementRows, lookup, dryRun) {
    const names = new Set();
    for (const row of requirementRows) {
        if (!isChildRequirement(row))
            continue;
        const hm = nullIfNa(rowGet(row, 'Hiring Manager'));
        if (hm)
            names.add(hm);
    }
    const passwordHash = dryRun ? 'dry-run' : await bcrypt.hash(DEV_PASSWORD, 10);
    let created = 0;
    let resolved = 0;
    for (const name of [...names].sort((a, b) => a.localeCompare(b))) {
        const result = await ensureHiringManagerUser(lookup, passwordHash, name, dryRun);
        if (!result)
            continue;
        resolved++;
        if (result.created) {
            created++;
            console.log(`  + hiring manager ${normalizePersonName(name)} <${hiringManagerEmailFromName(name)}> → ${dryRun ? '(dry-run)' : result.id}`);
        }
    }
    return { created, resolved };
}
/**
 * Ensure only allowed Recruiter-choice users (+ Alankar / Employee Referral).
 * Other Recruiter names map to Employee Referral (not created as RECRUITER).
 */
async function ensureLegacyRecruiters(candidateRows, requirementRows, lookup, dryRun) {
    /** name → email → count */
    const nameEmailVotes = new Map();
    const nameOnly = new Set();
    const vote = (name, email) => {
        nameOnly.add(name);
        if (!email)
            return;
        let m = nameEmailVotes.get(name);
        if (!m) {
            m = new Map();
            nameEmailVotes.set(name, m);
        }
        m.set(email, (m.get(email) || 0) + 1);
    };
    for (const row of candidateRows) {
        const names = splitPeopleParts(rowGet(row, 'Recruiter'));
        const emails = splitPeopleParts(rowGet(row, 'Recruiter Email')).filter((e) => e.includes('@'));
        if (names.length === 0)
            continue;
        if (names.length === 1) {
            vote(names[0], emails[0] ?? null);
            continue;
        }
        if (names.length === emails.length) {
            for (let i = 0; i < names.length; i++)
                vote(names[i], emails[i]);
        }
        else {
            for (const n of names)
                vote(n, null);
        }
    }
    // Manpower form recruiters (name-first as well)
    for (const row of requirementRows) {
        const names = splitPeopleParts(rowGet(row, 'Recruiter'));
        const emails = splitPeopleParts(rowGet(row, 'Recruiter Email')).filter((e) => e.includes('@'));
        if (names.length === 1 && emails.length === 1)
            vote(names[0], emails[0]);
        else if (names.length === emails.length && names.length > 0) {
            for (let i = 0; i < names.length; i++)
                vote(names[i], emails[i]);
        }
        else {
            for (const n of names)
                vote(n, null);
        }
    }
    const identities = [];
    for (const name of nameOnly) {
        const votes = nameEmailVotes.get(name);
        let bestEmail;
        let weight = 0;
        if (votes && votes.size) {
            const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
            bestEmail = ranked[0]?.[0];
            weight = [...votes.values()].reduce((a, b) => a + b, 0);
        }
        identities.push({ name, email: bestEmail, weight });
    }
    // Create longest (full) names first so short forms resolve onto them.
    identities.sort((a, b) => {
        const tokenDelta = normalizePersonName(b.name).split(/\s+/).filter(Boolean).length -
            normalizePersonName(a.name).split(/\s+/).filter(Boolean).length;
        if (tokenDelta !== 0)
            return tokenDelta;
        return b.weight - a.weight;
    });
    const passwordHash = dryRun ? 'dry-run' : await bcrypt.hash(DEV_PASSWORD, 10);
    let created = 0;
    let resolved = 0;
    let redirected = 0;
    const referralEnsure = await ensureRecruiterUser(lookup, passwordHash, { name: EMPLOYEE_REFERRAL_NAME }, dryRun);
    if (referralEnsure?.created) {
        created++;
        console.log(`  + recruiter ${EMPLOYEE_REFERRAL_NAME} → ${dryRun ? '(dry-run)' : referralEnsure.id}`);
    }
    const referralId = referralEnsure?.id ?? resolveUserIdByName(lookup, EMPLOYEE_REFERRAL_NAME) ?? null;
    for (const identity of identities) {
        if (!isAllowedRecruiterName(identity.name)) {
            redirected++;
            if (referralId) {
                lookup.byName.set(identity.name.toLowerCase(), referralId);
                lookup.byName.set(normalizePersonName(identity.name).toLowerCase(), referralId);
            }
            continue;
        }
        const result = await ensureRecruiterUser(lookup, passwordHash, identity, dryRun);
        if (!result)
            continue;
        resolved++;
        if (result.created) {
            created++;
            console.log(`  + recruiter ${identity.name}${identity.email ? ` <${identity.email}>` : ''} → ${dryRun ? '(dry-run)' : result.id}`);
        }
    }
    if (redirected > 0) {
        console.log(`  ↳ redirected ${redirected} non-allowed Recruiter name(s) → ${EMPLOYEE_REFERRAL_NAME}`);
    }
    return { created, resolved, redirected };
}
function monthLabel(date) {
    if (!date)
        return null;
    return date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
}
function quarterLabel(date) {
    if (!date)
        return null;
    const q = Math.floor(date.getMonth() / 3) + 1;
    const y = date.getFullYear().toString().slice(-2);
    return `Q${q}_${y}`;
}
function resolveRecruiterIds(lookup, row, fallbackUserId) {
    const ids = new Set();
    for (const name of splitPeopleParts(rowGet(row, 'Recruiter'))) {
        // Agencies / employees / unknown labels are not requirement assignees.
        if (!isAllowedRecruiterName(name))
            continue;
        if (normalizePersonName(name).toLowerCase() === EMPLOYEE_REFERRAL_NAME.toLowerCase())
            continue;
        const id = resolveUserId(lookup, name);
        if (id)
            ids.add(id);
    }
    for (const email of splitPeopleParts(rowGet(row, 'Recruiter Email'))) {
        if (!email.includes('@'))
            continue;
        const id = resolveUserId(lookup, email);
        if (!id)
            continue;
        // Only keep if this email already resolved to an allowed recruiter name in lookup.
        const matchedName = [...lookup.byName.entries()].find(([, uid]) => uid === id)?.[0];
        if (matchedName && !isAllowedRecruiterName(matchedName))
            continue;
        if (matchedName?.toLowerCase() === EMPLOYEE_REFERRAL_NAME.toLowerCase())
            continue;
        ids.add(id);
    }
    if (ids.size === 0)
        ids.add(fallbackUserId);
    return [...ids];
}
/** Candidate sheet Recruiter → createdBy; non-keepers become Employee Referral. */
function resolveCandidateOwner(lookup, row, fallbackUserId) {
    const sheetSource = nullIfNa(rowGet(row, 'Source')) || 'Legacy Import';
    const names = splitPeopleParts(rowGet(row, 'Recruiter'));
    if (names.length === 0) {
        return { createdBy: fallbackUserId, source: sheetSource, isEmployeeReferral: false };
    }
    const name = names[0];
    if (isAllowedRecruiterName(name)) {
        const id = resolveUserIdByName(lookup, name) ?? fallbackUserId;
        const isReferral = normalizePersonName(name).toLowerCase() === EMPLOYEE_REFERRAL_NAME.toLowerCase();
        return {
            createdBy: id,
            source: isReferral ? EMPLOYEE_REFERRAL_SOURCE : sheetSource,
            isEmployeeReferral: isReferral,
        };
    }
    return {
        createdBy: resolveUserIdByName(lookup, EMPLOYEE_REFERRAL_NAME) ??
            resolveUserIdByName(lookup, name) ??
            fallbackUserId,
        source: EMPLOYEE_REFERRAL_SOURCE,
        isEmployeeReferral: true,
    };
}
function buildRequirementData(reqId, row, userLookup, fallbackUserId) {
    const recruiterIds = resolveRecruiterIds(userLookup, row, fallbackUserId);
    const hmRaw = nullIfNa(rowGet(row, 'Hiring Manager'));
    const hiringManagerId = (hmRaw ? resolveUserIdByName(userLookup, hmRaw) : null) ?? fallbackUserId;
    return buildManpowerRequirementPayload(reqId, row, recruiterIds, fallbackUserId, hiringManagerId);
}
async function ensureVendorByName(name) {
    const clean = nullIfNa(name);
    if (!clean)
        return null;
    const existing = await prisma.vendor.findFirst({
        where: { name: { equals: clean, mode: 'insensitive' } },
        select: { id: true },
    });
    if (existing)
        return existing.id;
    const slug = clean
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24);
    const created = await prisma.vendor.create({
        data: {
            name: clean,
            code: `LEG-${slug || crypto.randomBytes(3).toString('hex')}`,
            email: `legacy.${slug || 'vendor'}@imported.local`,
            status: 'ACTIVE',
            notes: 'Created by legacy Manpower import',
        },
        select: { id: true },
    });
    return created.id;
}
async function linkVendorToRequirement(requirementId, vendorName, assignedBy) {
    if (!vendorName)
        return;
    const vendorId = await ensureVendorByName(vendorName);
    if (!vendorId)
        return;
    await prisma.vendorRequirement.upsert({
        where: {
            vendorId_requirementId: { vendorId, requirementId },
        },
        create: { vendorId, requirementId, assignedBy },
        update: {},
    });
}
async function importRequirements(candidateRows, requirementRows, opts, manifest, userLookup, fallbackUserId) {
    const requirementByReqId = new Map();
    let childCount = 0;
    let skippedNonChild = 0;
    for (const row of requirementRows) {
        if (!isChildRequirement(row)) {
            skippedNonChild++;
            continue;
        }
        const reqId = rowGet(row, 'ReqID-New');
        if (!reqId)
            continue;
        childCount++;
        if (!requirementByReqId.has(reqId))
            requirementByReqId.set(reqId, row);
    }
    const candidateReqIds = new Set();
    for (const row of candidateRows) {
        const reqId = rowGet(row, 'Title');
        if (reqId)
            candidateReqIds.add(reqId);
    }
    console.log(`\nRequirements: ${childCount} child req(s) in Manpower Form (${skippedNonChild} parent/other skipped), ${candidateReqIds.size} referenced by candidates`);
    const missingReqIds = [];
    let created = 0;
    for (const [reqId, row] of requirementByReqId) {
        const built = buildRequirementData(reqId, row, userLookup, fallbackUserId);
        const { _reqStatus: reqStatus, _recruiterCount: recruiterCount, _vendorName: vendorName, ...data } = built;
        const { filled: _filled, ...updateData } = data;
        const persistVendor = async (requirementId) => {
            if (opts.dryRun)
                return;
            await linkVendorToRequirement(requirementId, vendorName, fallbackUserId);
        };
        const existingId = manifest.requirements[reqId];
        if (existingId && !opts.dryRun) {
            const exists = await prisma.requirement.findUnique({ where: { id: existingId } });
            if (exists) {
                await prisma.requirement.update({
                    where: { id: exists.id },
                    data: updateData,
                });
                await persistVendor(exists.id);
                console.log(`  ↷ ${reqId} → updated ${exists.id} (${reqStatus})`);
                continue;
            }
        }
        const existingByCode = await prisma.requirement.findUnique({ where: { jobCode: reqId } });
        if (existingByCode) {
            manifest.requirements[reqId] = existingByCode.id;
            if (!opts.dryRun) {
                await prisma.requirement.update({
                    where: { id: existingByCode.id },
                    data: updateData,
                });
                await persistVendor(existingByCode.id);
            }
            console.log(`  ↷ ${reqId} → jobCode match/update ${existingByCode.id} (${reqStatus})`);
            continue;
        }
        if (opts.dryRun) {
            console.log(`  [dry-run] would create requirement ${reqId}: ${data.title} [${reqStatus}] recruiters=${recruiterCount}`);
            manifest.requirements[reqId] = `dry-run-req-${reqId}`;
            created++;
            continue;
        }
        const createdRow = await prisma.requirement.create({ data });
        await ensureInterviewPlan(createdRow.id);
        await persistVendor(createdRow.id);
        manifest.requirements[reqId] = createdRow.id;
        created++;
        console.log(`  ✓ ${reqId} → ${createdRow.id} (${reqStatus})`);
    }
    for (const reqId of candidateReqIds) {
        if (!requirementByReqId.has(reqId) && !manifest.requirements[reqId]) {
            missingReqIds.push(reqId);
        }
    }
    return { created, missingReqIds };
}
async function importCandidates(rows, opts, manifest, userLookup, fallbackUserId) {
    const emailToCandidateId = new Map();
    console.log(`\nCandidates: ${rows.length} row(s) after email dedupe`);
    for (const row of rows) {
        const email = normalizeEmail(rowGet(row, 'Email ID', 'Email ID1'));
        const name = rowGet(row, 'Candidate Name');
        const title = rowGet(row, 'Title');
        const resumeId = rowGet(row, 'RESUME ID');
        const legacyId = rowGet(row, 'ID');
        if (!email || !name) {
            console.warn(`  ⚠ Skipping row — missing email or name (resume ${resumeId || '?'})`);
            continue;
        }
        const rawRequirementId = manifest.requirements[title];
        const hasLinkedRequirement = Boolean(rawRequirementId && !rawRequirementId.startsWith('dry-run-'));
        const requirementId = hasLinkedRequirement ? rawRequirementId : null;
        if (!hasLinkedRequirement && title) {
            console.warn(`  ⚠ No requirement for Title ${title} — ${email} (creating without link)`);
        }
        const status = mapLegacyStatus(row);
        const appliedDate = parseLegacyDate(rowGet(row, 'Created')) ?? new Date();
        const submittedAt = parseLegacyDate(rowGet(row, 'DOR from Sourcing')) ??
            (requirementId ? appliedDate : null);
        const offerDate = parseLegacyDate(rowGet(row, 'Offer date'));
        const expectedJoiningDate = parseLegacyDate(rowGet(row, 'Expected DOJ'));
        const joiningDate = parseLegacyDate(rowGet(row, 'DOJ'));
        const reqReceiptDate = parseLegacyDate(rowGet(row, 'Req Receipt Date'));
        const owner = resolveCandidateOwner(userLookup, row, fallbackUserId);
        const createdBy = owner.createdBy;
        const sheetSourceMonth = nullIfNa(rowGet(row, 'Source-Month'));
        const sheetSourceWeek = nullIfNa(rowGet(row, 'Source week'));
        const sheetOfferMonth = nullIfNa(rowGet(row, 'Offer month'));
        const sheetOfferWeek = nullIfNa(rowGet(row, 'Offer Week'));
        const sheetJoinedMonth = nullIfNa(rowGet(row, 'Joined Month'));
        const sheetJoinedQuarter = nullIfNa(rowGet(row, 'Joined Quarter'));
        const partnerName = nullIfNa(rowGet(row, 'Partner Name'));
        const primarySkills = serializeSkills(parseSkillList(rowGet(row, 'Primary Skill')));
        const secondarySkills = serializeSkills(parseSkillList(rowGet(row, 'Secondary Skill')));
        const candidateData = {
            name,
            email,
            role: rowGet(row, 'Designation') || rowGet(row, 'JD Selection') || 'Candidate',
            status,
            matchScore: 0,
            source: owner.source,
            appliedDate,
            requirementId,
            jobTitle: nullIfNa(rowGet(row, 'Designation')) || null,
            createdBy,
            phone: nullIfNa(rowGet(row, 'Contact Number')) || null,
            location: nullIfNa(rowGet(row, 'Current Location')) || null,
            preferredLocation: nullIfNa(rowGet(row, 'Preferred Location')),
            linkedIn: null,
            portfolio: null,
            totalExperience: nullIfNa(rowGet(row, 'Total Exp')) || null,
            currentCompany: nullIfNa(rowGet(row, 'Current Company')) || null,
            currentCTC: nullIfNa(rowGet(row, 'Current CTC')) || null,
            expectedCTC: nullIfNa(rowGet(row, 'Expected CTC')) || null,
            noticePeriod: nullIfNa(rowGet(row, 'Notice Period', 'Notice period')) || null,
            pan: null,
            primarySkills,
            secondarySkills,
            resumeText: null,
            partnerName,
            hireCategory: nullIfNa(rowGet(row, 'Hire Category')),
            quarter: nullIfNa(rowGet(row, 'Quarter')),
            reqMonth: nullIfNa(rowGet(row, 'Req-Month')),
            reqReceiptDate,
            legacyResumeId: resumeId || null,
            sourceMonth: sheetSourceMonth || sourceMonthFromDate(submittedAt),
            sourceWeek: sheetSourceWeek || sourceWeekFromDate(submittedAt),
            submittedAt: requirementId ? submittedAt : submittedAt,
            offerDate,
            offerMonth: sheetOfferMonth || monthLabel(offerDate),
            offerWeek: sheetOfferWeek,
            offerQuarter: quarterLabel(offerDate),
            expectedJoiningDate,
            joiningDate,
            joiningMonth: sheetJoinedMonth || monthLabel(joiningDate),
            joiningQuarter: sheetJoinedQuarter || quarterLabel(joiningDate),
            ...buildCandidateSearchIndexFields({
                name,
                email,
                role: rowGet(row, 'Designation') || rowGet(row, 'JD Selection') || 'Candidate',
                jobTitle: rowGet(row, 'Designation') || null,
                location: rowGet(row, 'Current Location') || null,
                currentCompany: rowGet(row, 'Current Company') || null,
                primarySkills,
                secondarySkills,
                totalExperience: rowGet(row, 'Total Exp') || null,
                currentCTC: rowGet(row, 'Current CTC') || null,
                expectedCTC: rowGet(row, 'Expected CTC') || null,
                noticePeriod: rowGet(row, 'Notice Period', 'Notice period') || null,
            }),
        };
        if (!opts.dryRun && partnerName) {
            const vendorId = await ensureVendorByName(partnerName);
            if (vendorId)
                candidateData.vendorId = vendorId;
        }
        const existingManifest = manifest.candidatesByEmail[email];
        const existingDb = await findCandidateByEmail(email);
        if (opts.dryRun) {
            console.log(`  [dry-run] ${email} → ${status} (req ${title}, resume ${resumeId})`);
            const dryId = existingManifest?.candidateId ?? `dry-run-cand-${resumeId || email}`;
            emailToCandidateId.set(email, dryId);
            manifest.candidatesByEmail[email] = {
                candidateId: dryId,
                resumeId,
                title,
                legacyId,
            };
            if (resumeId)
                manifest.candidatesByResumeId[resumeId] = dryId;
            continue;
        }
        let candidateId;
        if (existingDb) {
            candidateId = existingDb.id;
            await prisma.candidate.update({
                where: { id: candidateId },
                data: candidateData,
            });
            console.log(`  ↷ updated ${email}`);
        }
        else if (existingManifest?.candidateId) {
            const found = await prisma.candidate.findUnique({ where: { id: existingManifest.candidateId } });
            if (found) {
                candidateId = found.id;
                await prisma.candidate.update({ where: { id: candidateId }, data: candidateData });
                console.log(`  ↷ updated ${email} (manifest)`);
            }
            else {
                const created = await prisma.candidate.create({ data: candidateData });
                candidateId = created.id;
                console.log(`  ✓ created ${email}`);
            }
        }
        else {
            const created = await prisma.candidate.create({ data: candidateData });
            candidateId = created.id;
            console.log(`  ✓ created ${email}`);
        }
        emailToCandidateId.set(email, candidateId);
        manifest.candidatesByEmail[email] = { candidateId, resumeId, title, legacyId };
        if (resumeId)
            manifest.candidatesByResumeId[resumeId] = candidateId;
    }
    return emailToCandidateId;
}
async function importInterviews(rows, opts, manifest, userLookup, fallbackUserId) {
    console.log('\nInterviews:');
    let created = 0;
    for (const row of rows) {
        const email = normalizeEmail(rowGet(row, 'Email ID', 'Email ID1'));
        const entry = manifest.candidatesByEmail[email];
        if (!entry)
            continue;
        const requirementId = manifest.requirements[entry.title];
        if (!requirementId || requirementId.startsWith('dry-run-')) {
            if (opts.dryRun) {
                const slots = extractInterviewSlots(row);
                if (slots.length) {
                    console.log(`  [dry-run] ${email}: ${slots.length} interview slot(s)`);
                    created += slots.length;
                }
            }
            continue;
        }
        if (opts.dryRun) {
            const slots = extractInterviewSlots(row);
            if (slots.length)
                console.log(`  [dry-run] ${email}: ${slots.length} interview slot(s)`);
            created += slots.length;
            continue;
        }
        const plan = await ensureInterviewPlan(requirementId);
        const stages = plan.stages;
        const subStatus = rowGet(row, 'Candidate Sub Status');
        for (const slot of extractInterviewSlots(row)) {
            const stage = stages[slot.stageOrder];
            if (!stage)
                continue;
            const scheduledAt = parseLegacyDate(slot.dateRaw) ??
                parseLegacyDate(rowGet(row, 'Created')) ??
                parseLegacyDate(rowGet(row, 'Scheduled date'));
            if (!scheduledAt)
                continue;
            const status = interviewRecordStatus(slot, subStatus, scheduledAt);
            const interviewerId = resolveUserId(userLookup, slot.panelEmail, slot.panelName) ?? fallbackUserId;
            const existing = await prisma.interview.findFirst({
                where: { candidateId: entry.candidateId, planStageId: stage.id },
            });
            if (existing)
                continue;
            const interview = await prisma.interview.create({
                data: {
                    candidateId: entry.candidateId,
                    requirementId,
                    planStageId: stage.id,
                    scheduledAt,
                    scheduledBy: interviewerId,
                    interviewerIds: JSON.stringify([interviewerId]),
                    type: stage.interviewType,
                    status,
                    duration: stage.defaultDuration,
                    meetingLink: rowGet(row, 'Meeting Link') || null,
                },
            });
            created++;
            if (status === 'COMPLETED') {
                const comments = rowGet(row, 'Comments', 'Comments3', 'Comments4', 'HR Comments') ||
                    'Imported from legacy SharePoint data.';
                const recommendation = legacyFeedbackRecommendation(row, slot.stageOrder);
                const feedbackExists = await prisma.feedback.findFirst({
                    where: { interviewId: interview.id },
                });
                if (!feedbackExists) {
                    await prisma.feedback.create({
                        data: {
                            interviewId: interview.id,
                            interviewerId,
                            candidateId: entry.candidateId,
                            rating: recommendation === 'NO_HIRE' ? 2 : recommendation === 'ON_HOLD' ? 3 : 4,
                            technicalRating: recommendation === 'NO_HIRE' ? 2 : 4,
                            communicationRating: recommendation === 'NO_HIRE' ? 2 : 4,
                            comments,
                            recommendation,
                        },
                    });
                }
            }
        }
    }
    console.log(`  ${opts.dryRun ? '[dry-run] would create' : 'created'} ${created} interview(s)`);
    return created;
}
async function importOffers(rows, opts, manifest, userLookup, fallbackUserId) {
    console.log('\nOffers:');
    let created = 0;
    for (const row of rows) {
        const offerDateRaw = rowGet(row, 'Offer date');
        if (!offerDateRaw)
            continue;
        const email = normalizeEmail(rowGet(row, 'Email ID', 'Email ID1'));
        const entry = manifest.candidatesByEmail[email];
        if (!entry)
            continue;
        const requirementId = manifest.requirements[entry.title];
        if (!requirementId || requirementId.startsWith('dry-run-')) {
            if (opts.dryRun)
                console.log(`  [dry-run] offer for ${email}`);
            created++;
            continue;
        }
        if (opts.dryRun) {
            console.log(`  [dry-run] offer for ${email}`);
            created++;
            continue;
        }
        const existing = await prisma.offer.findFirst({
            where: { candidateId: entry.candidateId, requirementId },
        });
        if (existing)
            continue;
        const annualCtc = parseCtcLakhs(rowGet(row, 'Recommended CTC', 'Exp CTC', 'Expected CTC')) ?? 0;
        const createdBy = resolveUserIdByName(userLookup, rowGet(row, 'Recruiter')) ??
            resolveUserId(userLookup, rowGet(row, 'Recruiter Email'), rowGet(row, 'Created By')) ??
            fallbackUserId;
        const offerData = await buildOfferCreateData({
            candidateId: entry.candidateId,
            requirementId,
            annualCtc,
            createdBy,
        });
        const doj = rowGet(row, 'DOJ');
        const offerStatus = doj ? 'ACCEPTED' : 'SENT';
        const sentAt = parseLegacyDate(offerDateRaw);
        await prisma.offer.create({
            data: {
                ...offerData,
                status: offerStatus,
                sentAt,
                respondedAt: doj ? parseLegacyDate(doj) : null,
                history: JSON.stringify([
                    {
                        id: crypto.randomUUID(),
                        date: new Date().toISOString(),
                        action: 'IMPORTED',
                        description: 'Imported from legacy SharePoint export',
                        userId: createdBy,
                    },
                ]),
            },
        });
        created++;
        console.log(`  ✓ offer for ${email} (${offerStatus})`);
    }
    console.log(`  ${opts.dryRun ? '[dry-run] would create' : 'created'} ${created} offer(s)`);
    return created;
}
async function attachResumes(rows, opts, manifest) {
    if (opts.skipResumes) {
        console.log('\nResumes: skipped (--skip-resumes)');
        return { attached: 0, fallbackUrl: 0, missing: 0 };
    }
    console.log('\nResumes:');
    let attached = 0;
    let fallbackUrl = 0;
    let missing = 0;
    let skippedExisting = 0;
    for (const row of rows) {
        const email = normalizeEmail(rowGet(row, 'Email ID', 'Email ID1'));
        const entry = manifest.candidatesByEmail[email];
        if (!entry)
            continue;
        const resumeId = rowGet(row, 'RESUME ID');
        const candidateName = rowGet(row, 'Candidate Name', 'Name');
        const file = resumeId ? findResumeFile(opts.dataDir, resumeId, candidateName) : null;
        const sharePointUrl = rowGet(row, 'Resume path');
        if (opts.dryRun) {
            if (file) {
                attached++;
                if (attached <= 20 || attached % 500 === 0) {
                    console.log(`  [dry-run] attach ${file.fileName} → ${email}`);
                }
            }
            else if (sharePointUrl.startsWith('http')) {
                fallbackUrl++;
                if (fallbackUrl <= 10)
                    console.log(`  [dry-run] SharePoint fallback → ${email}`);
            }
            else {
                missing++;
            }
            continue;
        }
        const candidate = await prisma.candidate.findUnique({ where: { id: entry.candidateId } });
        if (!candidate)
            continue;
        if (candidate.resumeFileName && !opts.forceResume) {
            skippedExisting++;
            continue;
        }
        if (file) {
            try {
                const buffer = fs.readFileSync(file.path);
                const textPayload = buildCandidateResumePayload('');
                let resumeText = candidate.resumeText;
                let primarySkills = candidate.primarySkills;
                let secondarySkills = candidate.secondarySkills;
                // Re-parse only when we do not already have resume text (full re-extract is expensive).
                if (!resumeText?.trim()) {
                    try {
                        const parsed = await extractResumeText(buffer, file.mime, file.fileName);
                        const payload = buildCandidateResumePayload(parsed);
                        resumeText = payload.resumeText;
                        if (parseSkillList(candidate.primarySkills).length === 0) {
                            primarySkills = payload.primarySkills;
                        }
                        if (parseSkillList(candidate.secondarySkills).length === 0) {
                            secondarySkills = payload.secondarySkills;
                        }
                    }
                    catch {
                        resumeText = resumeText ?? textPayload.resumeText;
                    }
                }
                await saveResumeFile(candidate.id, file.mime, buffer, file.fileName);
                // Postgres rejects \0 in text columns (common in binary/.doc extracts).
                const scrub = (v) => v == null ? v : v.replace(/\u0000/g, '');
                resumeText = scrub(resumeText) ?? null;
                primarySkills = scrub(primarySkills) ?? '[]';
                secondarySkills = scrub(secondarySkills) ?? '[]';
                await prisma.candidate.update({
                    where: { id: candidate.id },
                    data: {
                        resumeFileName: file.fileName,
                        resumeMimeType: file.mime,
                        resumeUrl: null,
                        resumeStorageKey: null,
                        resumeText,
                        primarySkills,
                        secondarySkills,
                        ...buildCandidateSearchIndexFields({
                            name: candidate.name,
                            email: candidate.email,
                            role: candidate.role,
                            jobTitle: candidate.jobTitle,
                            location: candidate.location,
                            currentCompany: candidate.currentCompany,
                            primarySkills,
                            secondarySkills,
                            resumeText,
                            totalExperience: candidate.totalExperience,
                            currentCTC: candidate.currentCTC,
                            expectedCTC: candidate.expectedCTC,
                            noticePeriod: candidate.noticePeriod,
                        }),
                    },
                });
                attached++;
                if (attached <= 20 || attached % 250 === 0) {
                    console.log(`  ✓ ${file.fileName} → ${email}`);
                }
            }
            catch (err) {
                console.error(`  ✗ ${email}:`, err instanceof Error ? err.message : err);
            }
        }
        else if (sharePointUrl.startsWith('http')) {
            await prisma.candidate.update({
                where: { id: candidate.id },
                data: {
                    resumeFileName: resumeId ? `${resumeId}.pdf` : 'resume.pdf',
                    resumeMimeType: 'application/pdf',
                    resumeUrl: sharePointUrl,
                    resumeStorageKey: null,
                },
            });
            fallbackUrl++;
            if (fallbackUrl <= 10 || fallbackUrl % 250 === 0) {
                console.log(`  ↷ SharePoint URL for ${email}`);
            }
        }
        else {
            missing++;
            if (missing <= 10 || missing % 500 === 0) {
                console.warn(`  ⚠ no resume file for ${email} (RESUME ID ${resumeId})`);
            }
        }
    }
    if (skippedExisting) {
        console.log(`  skipped ${skippedExisting} already attached (use --force-resume to overwrite)`);
    }
    console.log(`  attached ${attached}, SharePoint fallback ${fallbackUrl}, missing ${missing}`);
    return { attached, fallbackUrl, missing };
}
function printStats(stats) {
    console.log('\n--- Import preview ---');
    console.log(`Rows:              ${stats.totalRows}`);
    console.log(`Unique requirements: ${stats.uniqueTitles}`);
    console.log(`Unique emails:       ${stats.uniqueEmails}`);
    console.log(`Duplicate emails:    ${stats.duplicateEmails}`);
    console.log(`Resume IDs:          ${stats.uniqueResumeIds}`);
    console.log(`Resume Attach=Yes:   ${stats.resumeAttachYes}`);
    console.log(`Missing resume files: ${stats.missingResumeFiles.length}`);
    if (stats.missingResumeFiles.length) {
        console.log(`  ${stats.missingResumeFiles.slice(0, 20).join(', ')}${stats.missingResumeFiles.length > 20 ? '…' : ''}`);
    }
    console.log('Statuses:', stats.statuses);
}
export async function run(argv = []) {
    const opts = parseArgs(argv);
    const rows = loadLegacyCsv(opts.dataDir);
    const requirementRows = loadLegacyRequirementCsv(opts.dataDir);
    if (rows.length === 0) {
        console.error('No data rows in CSV.');
        process.exit(1);
    }
    if (requirementRows.length === 0) {
        console.error('No requirement rows found in Manpower Requisition Form.csv.');
        process.exit(1);
    }
    const stats = buildImportStats(rows, opts.dataDir);
    printStats(stats);
    console.log(`Requirement rows:   ${requirementRows.length}`);
    const { selected, skipped } = dedupeRowsByEmail(rows, pipelineRank);
    const manifest = loadManifest(opts.manifestPath) ?? createEmptyManifest(opts.dataDir);
    manifest.skippedRows = [...manifest.skippedRows, ...skipped];
    manifest.dataDir = opts.dataDir;
    const fallbackUserId = opts.dryRun ? 'dry-run-user' : await resolveFallbackUserId(opts.createdBy);
    const userLookup = opts.dryRun ? createEmptyLookup() : await buildUserLookup();
    console.log(`\nMode: ${opts.dryRun ? 'DRY RUN' : 'IMPORT'}${opts.resumesOnly ? ' (resumes only)' : ''}`);
    console.log(`Data: ${opts.dataDir}`);
    console.log(`Manifest: ${opts.manifestPath}`);
    let requirementCreated = 0;
    let missingReqIds = [];
    let interviewCount = 0;
    let offerCount = 0;
    let resumeStats = { attached: 0, fallbackUrl: 0, missing: 0 };
    if (opts.resumesOnly) {
        const manifestCount = Object.keys(manifest.candidatesByEmail).length;
        if (manifestCount === 0 && !opts.dryRun) {
            console.error('Manifest has no candidates — run a full import before --resumes-only.');
            process.exit(1);
        }
        console.log(`\nResumes-only: attaching files for ${manifestCount} mapped candidate(s)`);
        resumeStats = await attachResumes(selected, opts, manifest);
    }
    else {
        console.log('\nEnsuring recruiter users from Candidate / Manpower sheets…');
        const recruiterEnsure = await ensureLegacyRecruiters(selected, requirementRows, userLookup, opts.dryRun);
        console.log(`  Recruiters resolved: ${recruiterEnsure.resolved}, newly created: ${recruiterEnsure.created}, redirected: ${recruiterEnsure.redirected}`);
        console.log('\nEnsuring hiring manager users from Manpower sheet…');
        const hmEnsure = await ensureLegacyHiringManagers(requirementRows, userLookup, opts.dryRun);
        console.log(`  Hiring managers resolved: ${hmEnsure.resolved}, newly created: ${hmEnsure.created}`);
        ({ created: requirementCreated, missingReqIds } = await importRequirements(selected, requirementRows, opts, manifest, userLookup, fallbackUserId));
        if (!opts.onlyRequirements) {
            await importCandidates(selected, opts, manifest, userLookup, fallbackUserId);
            interviewCount = await importInterviews(selected, opts, manifest, userLookup, fallbackUserId);
            offerCount = await importOffers(selected, opts, manifest, userLookup, fallbackUserId);
            resumeStats = await attachResumes(selected, opts, manifest);
        }
        else {
            console.log('\nSkipping candidates / interviews / offers / resumes (--only-requirements)');
        }
    }
    if (!opts.dryRun) {
        saveManifest(opts.manifestPath, manifest);
        console.log(`\nManifest saved: ${opts.manifestPath}`);
    }
    else {
        console.log('\nDry run complete — no database or manifest changes.');
    }
    const reportPath = path.join(opts.dataDir, 'report.xlsx');
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
        }
        if (row.candidateId && row.action === 'would_import') {
            row.action = 'created';
        }
    }
    const writtenReport = await writeLegacyImportWorkbook({
        reportPath,
        dataDir: opts.dataDir,
        reportRows,
        skippedDuplicates: skipped,
        missingRequirementIds: missingReqIds,
        requirementCount: Object.keys(manifest.requirements).length || requirementCreated,
        interviewCount,
        offerCount,
        resumeAttachedCount: resumeStats.attached,
    });
    console.log(`\nExcel report written: ${writtenReport}`);
    console.log('\nDone.');
}
