/**
 * Import / update interview feedback from SharePoint Interview Feedback Tracker (IFT) CSV.
 *
 *   npx tsx src/scripts/import-ift-feedback.ts --csv "C:\path\Interview Feedback Tracker(IFT).csv" --dry-run
 *   npx tsx src/scripts/import-ift-feedback.ts --csv "C:\path\Interview Feedback Tracker(IFT).csv"
 */
import '../../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { ensureInterviewPlan } from '../../lib/interviewPlan.js';
import { DEV_PASSWORD } from '../../config/devUsers.js';
import { parseLegacyCsv } from '../../lib/legacyImport/parseCsv.js';
import { buildIftFormData, groupIftRows, isPlaceholderPerson, } from '../../lib/legacyImport/iftFeedback.js';
import { ensureStitchUser, loadStitchUserLookup, normalizePersonName, } from '../../lib/legacyImport/ensureStitchUser.js';
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
            for (const name of [
                'Interview Feedback Tracker(IFT).csv',
                'Interview Feedback Tracker (IFT).csv',
            ]) {
                const candidate = path.join(dir, name);
                if (fs.existsSync(candidate)) {
                    csvPath = candidate;
                    break;
                }
            }
        }
    }
    if (!csvPath) {
        throw new Error('Missing --csv <path to Interview Feedback Tracker (IFT).csv>');
    }
    const resolved = path.resolve(csvPath);
    if (!fs.existsSync(resolved))
        throw new Error(`CSV not found: ${resolved}`);
    return { csvPath: resolved, dryRun };
}
function resolveInterviewerId(lookup, name, fallback) {
    const v = normalizePersonName(name).toLowerCase();
    if (v && !isPlaceholderPerson(v)) {
        const id = lookup.byName.get(v) ?? lookup.byName.get(name.trim().toLowerCase());
        if (id)
            return id;
    }
    return fallback;
}
async function resolveFallbackUserId() {
    const admin = await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    });
    if (!admin)
        throw new Error('No SUPER_ADMIN user found.');
    return admin.id;
}
async function resolveRequirementId(candidateRequirementId, reqCode, reqByCode) {
    if (reqCode && reqByCode.has(reqCode))
        return reqByCode.get(reqCode);
    return candidateRequirementId;
}
async function upsertRoundFeedback(opts) {
    const { candidateId, requirementId, payload, userLookup, fallbackUserId, dryRun, stats } = opts;
    const plan = await ensureInterviewPlan(requirementId);
    const stage = plan.stages.find((s) => s.order === payload.stageOrder);
    if (!stage) {
        stats.skippedNoStage++;
        return;
    }
    const interviewerId = resolveInterviewerId(userLookup, payload.interviewerName, fallbackUserId);
    const scheduledAt = payload.scheduledAt ?? new Date();
    let interview = await prisma.interview.findFirst({
        where: { candidateId, requirementId, planStageId: stage.id },
    });
    if (!interview) {
        if (dryRun) {
            stats.interviewsCreated++;
            stats.feedbackCreated++;
            return;
        }
        interview = await prisma.interview.create({
            data: {
                candidateId,
                requirementId,
                planStageId: stage.id,
                scheduledAt,
                scheduledBy: interviewerId,
                interviewerIds: JSON.stringify([interviewerId]),
                type: stage.interviewType,
                status: 'COMPLETED',
                duration: stage.defaultDuration,
            },
        });
        stats.interviewsCreated++;
    }
    else if (!dryRun) {
        await prisma.interview.update({
            where: { id: interview.id },
            data: {
                scheduledAt: payload.scheduledAt ?? interview.scheduledAt,
                status: 'COMPLETED',
            },
        });
        stats.interviewsUpdated++;
    }
    else {
        stats.interviewsUpdated++;
    }
    const formData = buildIftFormData(payload);
    const feedbackData = {
        interviewerId,
        rating: payload.rating,
        technicalRating: payload.technicalRating ?? payload.rating,
        communicationRating: payload.rating,
        comments: payload.comments,
        recommendation: payload.recommendation,
        formData,
    };
    const existing = await prisma.feedback.findFirst({
        where: { interviewId: interview.id },
        orderBy: { createdAt: 'desc' },
    });
    if (dryRun) {
        if (existing)
            stats.feedbackUpdated++;
        else
            stats.feedbackCreated++;
        return;
    }
    if (existing) {
        await prisma.feedback.update({
            where: { id: existing.id },
            data: feedbackData,
        });
        stats.feedbackUpdated++;
    }
    else {
        await prisma.feedback.create({
            data: {
                interviewId: interview.id,
                candidateId,
                ...feedbackData,
            },
        });
        stats.feedbackCreated++;
    }
}
export async function run(argv = []) {
    const { csvPath, dryRun } = parseArgs(argv);
    console.log(`IFT feedback import${dryRun ? ' (dry-run)' : ''}`);
    console.log(`  CSV: ${csvPath}`);
    const rows = parseLegacyCsv(fs.readFileSync(csvPath, 'utf8'));
    const groups = groupIftRows(rows);
    console.log(`  Parsed ${rows.length} row(s) → ${groups.length} candidate/req group(s)`);
    const fallbackUserId = dryRun ? 'dry-run' : await resolveFallbackUserId();
    const userLookup = dryRun
        ? { byEmail: new Map(), byName: new Map(), emailName: new Map() }
        : await loadStitchUserLookup();
    const passwordHash = dryRun ? 'dry-run' : await bcrypt.hash(DEV_PASSWORD, 10);
    // Ensure every IFT interviewer exists as INTERVIEWER (@ats.igsglobal.co if new).
    const interviewerNames = new Set();
    for (const g of groups) {
        if (g.l1?.interviewerName && !isPlaceholderPerson(g.l1.interviewerName)) {
            interviewerNames.add(g.l1.interviewerName);
        }
        if (g.l2?.interviewerName && !isPlaceholderPerson(g.l2.interviewerName)) {
            interviewerNames.add(g.l2.interviewerName);
        }
    }
    let interviewersCreated = 0;
    console.log(`\nEnsuring ${interviewerNames.size} interviewer(s)…`);
    for (const name of [...interviewerNames].sort((a, b) => a.localeCompare(b))) {
        const result = await ensureStitchUser(userLookup, {
            name,
            role: 'INTERVIEWER',
            dryRun,
            passwordHash,
        });
        if (result?.created) {
            interviewersCreated++;
            console.log(`  + interviewer ${normalizePersonName(name)} <${result.email}>`);
        }
    }
    console.log(`  Interviewers created: ${interviewersCreated}`);
    const candidates = await prisma.candidate.findMany({
        select: { id: true, name: true, legacyResumeId: true, requirementId: true },
    });
    const byResume = new Map(candidates.filter((c) => c.legacyResumeId).map((c) => [c.legacyResumeId.trim(), c]));
    const reqs = await prisma.requirement.findMany({ select: { id: true, jobCode: true } });
    const reqByCode = new Map(reqs.filter((r) => r.jobCode).map((r) => [r.jobCode.trim().toUpperCase(), r.id]));
    const stats = {
        groups: groups.length,
        candidatesMatched: 0,
        candidatesMissing: 0,
        noRequirement: 0,
        skippedNoStage: 0,
        interviewsCreated: 0,
        interviewsUpdated: 0,
        feedbackCreated: 0,
        feedbackUpdated: 0,
        l1Rounds: 0,
        l2Rounds: 0,
    };
    const missingSamples = [];
    for (const group of groups) {
        const candidate = byResume.get(group.resumeId);
        if (!candidate) {
            stats.candidatesMissing++;
            if (missingSamples.length < 20) {
                missingSamples.push(`${group.resumeId} ${group.candidateName}`);
            }
            continue;
        }
        stats.candidatesMatched++;
        const requirementId = await resolveRequirementId(candidate.requirementId, group.reqCode, reqByCode);
        if (!requirementId) {
            stats.noRequirement++;
            continue;
        }
        if (group.l1) {
            stats.l1Rounds++;
            await upsertRoundFeedback({
                candidateId: candidate.id,
                requirementId,
                payload: group.l1,
                userLookup,
                fallbackUserId,
                dryRun,
                stats,
            });
        }
        if (group.l2) {
            stats.l2Rounds++;
            await upsertRoundFeedback({
                candidateId: candidate.id,
                requirementId,
                payload: group.l2,
                userLookup,
                fallbackUserId,
                dryRun,
                stats,
            });
        }
    }
    console.log('\n=== Summary ===');
    for (const [k, v] of Object.entries(stats)) {
        console.log(`  ${k}: ${v}`);
    }
    if (missingSamples.length) {
        console.log('\nUnmatched resume IDs (sample):');
        for (const s of missingSamples)
            console.log(`  - ${s}`);
    }
    if (dryRun)
        console.log('\n(dry-run — no database writes)');
}
