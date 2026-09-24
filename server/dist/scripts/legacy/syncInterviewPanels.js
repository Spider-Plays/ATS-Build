/**
 * Populate L1 / Managerial / HR interview panels from legacy Candidate sheet + IFT,
 * plus interviewers already assigned on imported interviews.
 *
 *   npx tsx src/scripts/sync-legacy-interview-panels.ts --data-dir "C:\path\to\data"
 */
import '../../config/loadEnv.js';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { ensureInterviewPanelCatalog, listInterviewPanelLevels, updateInterviewPanelLevel, } from '../../lib/interviewPanelCatalog.js';
import { ensureStitchUser, isPlaceholderPerson, loadStitchUserLookup, } from '../../lib/legacyImport/ensureStitchUser.js';
import { loadLegacyCsv, parseLegacyCsv, rowGet } from '../../lib/legacyImport/parseCsv.js';
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
function addName(bucket, raw) {
    if (!raw || isPlaceholderPerson(raw))
        return;
    const cleaned = raw.replace(/\u00a0/g, ' ').trim();
    if (!cleaned)
        return;
    // SharePoint stubs that are not real panel members
    if (/^(client|client interview|to be decided|tbd|yet to decide|external|panel)$/i.test(cleaned)) {
        return;
    }
    bucket.add(cleaned);
}
async function ensureNames(lookup, names, dryRun) {
    const ids = [];
    for (const name of names) {
        if (dryRun) {
            const existing = lookup.byName.get(name.trim().toLowerCase().replace(/\s+/g, ' ')) ??
                lookup.byEmail.get(`${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@ats.igsglobal.co`);
            if (existing)
                ids.push(existing);
            continue;
        }
        const user = await ensureStitchUser(lookup, { name, role: 'INTERVIEWER' });
        if (user?.id)
            ids.push(user.id);
    }
    return ids;
}
export async function run(argv = []) {
    const { dataDir, dryRun } = parseArgs(argv);
    console.log(`Sync legacy interview panels${dryRun ? ' (dry-run)' : ''}`);
    console.log(`  Data: ${dataDir}`);
    await ensureInterviewPanelCatalog();
    const lookup = await loadStitchUserLookup();
    const l1Names = new Set();
    const l2Names = new Set();
    const hrNames = new Set();
    const sheetRows = loadLegacyCsv(dataDir);
    for (const row of sheetRows) {
        addName(l1Names, rowGet(row, 'Panel Name'));
        addName(l2Names, rowGet(row, 'Panel Name2'));
        addName(hrNames, rowGet(row, 'Interview Panel'));
    }
    console.log(`  Candidate sheet names: L1=${l1Names.size}, L2=${l2Names.size}, HR=${hrNames.size}`);
    const iftPath = path.join(dataDir, 'Interview Feedback Tracker(IFT).csv');
    if (fs.existsSync(iftPath)) {
        const iftRows = parseLegacyCsv(fs.readFileSync(iftPath, 'utf8'));
        const groups = groupIftRows(iftRows);
        for (const g of groups) {
            if (g.l1?.interviewerName)
                addName(l1Names, g.l1.interviewerName);
            if (g.l2?.interviewerName)
                addName(l2Names, g.l2.interviewerName);
        }
        console.log(`  After IFT: L1=${l1Names.size}, L2=${l2Names.size}, HR=${hrNames.size}`);
    }
    const l1FromCsv = await ensureNames(lookup, l1Names, dryRun);
    const l2FromCsv = await ensureNames(lookup, l2Names, dryRun);
    const hrFromCsv = await ensureNames(lookup, hrNames, dryRun);
    // Interviewers already on imported interviews → matching panel by stage order
    const interviews = await prisma.interview.findMany({
        select: {
            interviewerIds: true,
            planStage: { select: { order: true } },
        },
    });
    const fromIv = [
        new Set(),
        new Set(),
        new Set(),
    ];
    for (const iv of interviews) {
        const order = iv.planStage?.order;
        if (order == null || order < 0 || order > 2)
            continue;
        let ids = [];
        try {
            ids = JSON.parse(iv.interviewerIds || '[]');
        }
        catch {
            ids = [];
        }
        for (const id of ids) {
            if (typeof id === 'string' && id.trim())
                fromIv[order].add(id);
        }
    }
    // Active HR role users → HR panel
    const hrRoleUsers = await prisma.user.findMany({
        where: { status: 'ACTIVE', role: { in: ['HR_MANAGER', 'HR_HEAD'] } },
        select: { id: true },
    });
    const levels = await listInterviewPanelLevels();
    const byOrder = new Map(levels.map((l) => [l.order, l]));
    const junkUserIds = new Set((await prisma.user.findMany({
        where: {
            OR: [
                { name: { equals: 'Client', mode: 'insensitive' } },
                { name: { equals: 'Client interview', mode: 'insensitive' } },
                { name: { equals: 'External', mode: 'insensitive' } },
                { name: { equals: 'Panel', mode: 'insensitive' } },
            ],
        },
        select: { id: true },
    })).map((u) => u.id));
    const merge = (order, extra) => {
        const level = byOrder.get(order);
        if (!level)
            return { added: 0, total: 0 };
        const next = [
            ...new Set([...level.interviewerIds, ...extra].filter((id) => !junkUserIds.has(id))),
        ];
        const added = next.length - level.interviewerIds.filter((id) => !junkUserIds.has(id)).length;
        return { level, next, added, total: next.length };
    };
    const plans = [
        merge(0, [...l1FromCsv, ...fromIv[0]]),
        merge(1, [...l2FromCsv, ...fromIv[1]]),
        merge(2, [...hrFromCsv, ...fromIv[2], ...hrRoleUsers.map((u) => u.id)]),
    ];
    for (const p of plans) {
        if (!('level' in p) || !p.level)
            continue;
        const changed = p.next.length !== p.level.interviewerIds.length ||
            p.next.some((id, i) => id !== p.level.interviewerIds[i]);
        console.log(`  ${p.level.name}: +${Math.max(0, p.added)} → ${p.total} members`);
        if (!dryRun && changed) {
            await updateInterviewPanelLevel(p.level.id, p.next);
        }
    }
    const final = await listInterviewPanelLevels();
    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    console.log('Final panels:');
    for (const level of final) {
        const sample = level.interviewerIds
            .slice(0, 8)
            .map((id) => nameById.get(id) ?? id)
            .join(', ');
        const more = level.interviewerIds.length > 8 ? ` …+${level.interviewerIds.length - 8}` : '';
        console.log(`  ${level.name} (${level.interviewerIds.length}): ${sample || '—'}${more}`);
    }
}
