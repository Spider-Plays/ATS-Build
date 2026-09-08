/**
 * Repair interview scheduledAt from Candidate sheet (DD-MM-YYYY) and IFT dates.
 *
 *   npx tsx src/scripts/repair-interview-dates-from-csv.ts --data-dir "C:\path\to\data"
 */
import '../../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { ensureInterviewPlan } from '../../lib/interviewPlan.js';
import { loadLegacyCsv, normalizeEmail, parseLegacyCsv, parseLegacyDate, rowGet, } from '../../lib/legacyImport/parseCsv.js';
import { extractInterviewSlots, interviewRecordStatus } from '../../lib/legacyImport/statusMap.js';
import { groupIftRows } from '../../lib/legacyImport/iftFeedback.js';
function parseArgs(argv) {
    let dataDir = '';
    let dryRun = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dry-run')
            dryRun = true;
        else if (argv[i] === '--data-dir')
            dataDir = argv[++i] ?? '';
    }
    if (!dataDir)
        throw new Error('Missing --data-dir');
    return { dataDir: path.resolve(dataDir), dryRun };
}
export async function run(argv = []) {
    const { dataDir, dryRun } = parseArgs(argv);
    console.log(`Repair interview dates${dryRun ? ' (dry-run)' : ''}`);
    console.log(`  Data: ${dataDir}`);
    const rows = loadLegacyCsv(dataDir);
    const byEmail = new Map();
    for (const row of rows) {
        const email = normalizeEmail(rowGet(row, 'Email ID', 'Email ID1'));
        if (email)
            byEmail.set(email, row);
    }
    const candidates = await prisma.candidate.findMany({
        select: { id: true, email: true, requirementId: true, legacyResumeId: true },
    });
    let sheetUpdated = 0;
    let sheetMissing = 0;
    for (const cand of candidates) {
        const row = byEmail.get(cand.email.toLowerCase());
        if (!row)
            continue;
        const slots = extractInterviewSlots(row);
        if (!slots.length)
            continue;
        if (!cand.requirementId) {
            sheetMissing++;
            continue;
        }
        const plan = await ensureInterviewPlan(cand.requirementId);
        const subStatus = rowGet(row, 'Candidate Sub Status');
        for (const slot of slots) {
            const stage = plan.stages[slot.stageOrder];
            if (!stage)
                continue;
            const scheduledAt = parseLegacyDate(slot.dateRaw);
            if (!scheduledAt)
                continue;
            const status = interviewRecordStatus(slot, subStatus, scheduledAt);
            const existing = await prisma.interview.findFirst({
                where: { candidateId: cand.id, planStageId: stage.id },
                select: { id: true, scheduledAt: true },
            });
            if (!existing)
                continue;
            if (existing.scheduledAt.getTime() === scheduledAt.getTime())
                continue;
            sheetUpdated++;
            if (sheetUpdated <= 15 || sheetUpdated % 200 === 0) {
                console.log(`  sheet ${cand.email} stage${slot.stageOrder}: ${existing.scheduledAt.toISOString()} → ${scheduledAt.toISOString()} (${slot.dateRaw})`);
            }
            if (!dryRun) {
                await prisma.interview.update({
                    where: { id: existing.id },
                    data: { scheduledAt, status },
                });
            }
        }
    }
    console.log(`  Candidate-sheet date updates: ${sheetUpdated}`);
    // IFT DOI is mixed MDY/DMY — only fill stages with no Candidate-sheet date.
    // (Blind IFT overwrite previously pushed many interviews into future months.)
    const iftPath = path.join(dataDir, 'Interview Feedback Tracker(IFT).csv');
    let iftUpdated = 0;
    if (fs.existsSync(iftPath)) {
        const iftRows = parseLegacyCsv(fs.readFileSync(iftPath, 'utf8'));
        const groups = groupIftRows(iftRows);
        const byResume = new Map(candidates
            .filter((c) => c.legacyResumeId)
            .map((c) => [c.legacyResumeId.trim(), c]));
        const reqs = await prisma.requirement.findMany({ select: { id: true, jobCode: true } });
        const reqByCode = new Map(reqs.filter((r) => r.jobCode).map((r) => [r.jobCode.trim().toUpperCase(), r.id]));
        for (const group of groups) {
            const cand = byResume.get(group.resumeId);
            if (!cand)
                continue;
            const sheet = byEmail.get(cand.email.toLowerCase());
            const sheetSlots = sheet ? extractInterviewSlots(sheet) : [];
            const requirementId = (group.reqCode && reqByCode.get(group.reqCode.trim().toUpperCase())) ||
                cand.requirementId;
            if (!requirementId)
                continue;
            const plan = await ensureInterviewPlan(requirementId);
            for (const payload of [group.l1, group.l2]) {
                if (!payload?.scheduledAt)
                    continue;
                const sheetHas = sheetSlots.some((s) => s.stageOrder === payload.stageOrder && s.dateRaw?.trim());
                if (sheetHas)
                    continue;
                const stage = plan.stages.find((s) => s.order === payload.stageOrder);
                if (!stage)
                    continue;
                const existing = await prisma.interview.findFirst({
                    where: { candidateId: cand.id, planStageId: stage.id },
                    select: { id: true, scheduledAt: true },
                });
                if (!existing)
                    continue;
                if (existing.scheduledAt.getTime() === payload.scheduledAt.getTime())
                    continue;
                iftUpdated++;
                if (iftUpdated <= 15 || iftUpdated % 200 === 0) {
                    console.log(`  ift ${group.resumeId} ${payload.round}: ${existing.scheduledAt.toISOString()} → ${payload.scheduledAt.toISOString()}`);
                }
                if (!dryRun) {
                    await prisma.interview.update({
                        where: { id: existing.id },
                        data: { scheduledAt: payload.scheduledAt },
                    });
                }
            }
        }
    }
    console.log(`  IFT date updates (sheet-empty only): ${iftUpdated}`);
    // Last pass: any interview still in the future → pull back via IFT (all req copies)
    let futureFixed = 0;
    const futureCutoff = new Date();
    futureCutoff.setHours(23, 59, 59, 999);
    if (fs.existsSync(iftPath)) {
        const iftRows = parseLegacyCsv(fs.readFileSync(iftPath, 'utf8'));
        const groups = groupIftRows(iftRows);
        const byResume = new Map(candidates
            .filter((c) => c.legacyResumeId)
            .map((c) => [c.legacyResumeId.trim(), c]));
        for (const group of groups) {
            const cand = byResume.get(group.resumeId);
            if (!cand)
                continue;
            for (const payload of [group.l1, group.l2]) {
                if (!payload?.scheduledAt)
                    continue;
                if (payload.scheduledAt.getTime() > futureCutoff.getTime())
                    continue;
                const existingList = await prisma.interview.findMany({
                    where: {
                        candidateId: cand.id,
                        scheduledAt: { gt: futureCutoff },
                        planStage: { order: payload.stageOrder },
                    },
                    select: { id: true, scheduledAt: true },
                });
                for (const existing of existingList) {
                    if (existing.scheduledAt.getTime() === payload.scheduledAt.getTime())
                        continue;
                    futureFixed++;
                    if (futureFixed <= 20) {
                        console.log(`  future-fix ${group.resumeId} ${payload.round}: ${existing.scheduledAt.toISOString()} → ${payload.scheduledAt.toISOString()}`);
                    }
                    if (!dryRun) {
                        await prisma.interview.update({
                            where: { id: existing.id },
                            data: { scheduledAt: payload.scheduledAt },
                        });
                    }
                }
            }
        }
    }
    console.log(`  Future interviews pulled back via IFT: ${futureFixed}`);
    // Sheet pull-back for any remaining future rows (e.g. no IFT)
    let sheetFutureFixed = 0;
    for (const cand of candidates) {
        const row = byEmail.get(cand.email.toLowerCase());
        if (!row)
            continue;
        const slots = extractInterviewSlots(row);
        for (const slot of slots) {
            const scheduledAt = parseLegacyDate(slot.dateRaw);
            if (!scheduledAt || scheduledAt.getTime() > futureCutoff.getTime())
                continue;
            const existingList = await prisma.interview.findMany({
                where: {
                    candidateId: cand.id,
                    scheduledAt: { gt: futureCutoff },
                    planStage: { order: slot.stageOrder },
                },
                select: { id: true, scheduledAt: true },
            });
            for (const existing of existingList) {
                sheetFutureFixed++;
                if (!dryRun) {
                    await prisma.interview.update({
                        where: { id: existing.id },
                        data: { scheduledAt },
                    });
                }
            }
        }
    }
    console.log(`  Future interviews pulled back via sheet: ${sheetFutureFixed}`);
    const remainingFuture = await prisma.interview.count({
        where: { scheduledAt: { gt: new Date() } },
    });
    const remainingDec = await prisma.interview.count({
        where: {
            scheduledAt: {
                gte: new Date('2026-12-01T00:00:00.000Z'),
                lt: new Date('2027-01-01T00:00:00.000Z'),
            },
        },
    });
    console.log(`  Interviews still in the future: ${remainingFuture}`);
    console.log(`  Interviews still in Dec 2026: ${remainingDec}`);
    if (dryRun)
        console.log('\n(dry-run — no database writes)');
}
