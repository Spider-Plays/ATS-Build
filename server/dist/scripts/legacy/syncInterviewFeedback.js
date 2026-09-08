/**
 * Fix legacy interview feedback so Reject / in-progress candidates are not shown as Selected.
 *
 *   npm run db:legacy -- sync-interview-feedback --data-dir "...\data"
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { dedupeRowsByEmail, loadLegacyCsv, normalizeEmail, rowGet, } from '../../lib/legacyImport/parseCsv.js';
import { legacyFeedbackRecommendation, pipelineRank, } from '../../lib/legacyImport/statusMap.js';
function parseDataDir(argv) {
    const idx = argv.indexOf('--data-dir');
    const dataDir = idx >= 0 ? argv[idx + 1] : '';
    if (!dataDir)
        throw new Error('Missing --data-dir');
    return dataDir;
}
export async function run(argv = []) {
    const dataDir = parseDataDir(argv);
    const rows = loadLegacyCsv(dataDir);
    const { selected } = dedupeRowsByEmail(rows, pipelineRank);
    const byEmail = new Map(selected
        .map((r) => {
        const email = normalizeEmail(rowGet(r, 'Email ID', 'Email ID1'));
        return email ? [email, r] : null;
    })
        .filter((x) => Boolean(x)));
    const fallbackUserId = (await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' },
        select: { id: true },
    }))?.id ?? null;
    const candidates = await prisma.candidate.findMany({
        select: { id: true, email: true, status: true },
    });
    const candById = new Map(candidates.map((c) => [c.id, c]));
    const interviews = await prisma.interview.findMany({
        select: {
            id: true,
            candidateId: true,
            planStageId: true,
            status: true,
            scheduledBy: true,
        },
    });
    const stageOrderCache = new Map();
    let updated = 0;
    let created = 0;
    let unchanged = 0;
    const changes = new Map();
    for (const iv of interviews) {
        const cand = candById.get(iv.candidateId);
        if (!cand)
            continue;
        const row = byEmail.get(cand.email.toLowerCase());
        if (!row)
            continue;
        let stageOrder = 0;
        if (iv.planStageId) {
            if (!stageOrderCache.has(iv.planStageId)) {
                const stage = await prisma.interviewPlanStage.findUnique({
                    where: { id: iv.planStageId },
                    select: { order: true },
                });
                stageOrderCache.set(iv.planStageId, stage?.order ?? 0);
            }
            stageOrder = stageOrderCache.get(iv.planStageId) ?? 0;
        }
        const want = legacyFeedbackRecommendation(row, stageOrder);
        const feedback = await prisma.feedback.findFirst({
            where: { interviewId: iv.id },
            select: { id: true, recommendation: true },
        });
        if (!feedback) {
            if (iv.status !== 'COMPLETED') {
                unchanged++;
                continue;
            }
            const interviewerId = iv.scheduledBy || fallbackUserId;
            if (!interviewerId)
                continue;
            await prisma.feedback.create({
                data: {
                    interviewId: iv.id,
                    interviewerId,
                    candidateId: iv.candidateId,
                    rating: want === 'NO_HIRE' ? 2 : want === 'ON_HOLD' ? 3 : 4,
                    technicalRating: want === 'NO_HIRE' ? 2 : 3,
                    communicationRating: want === 'NO_HIRE' ? 2 : 3,
                    comments: 'Imported/corrected from legacy Candidate sheet status.',
                    recommendation: want,
                },
            });
            created++;
            changes.set(`(none) → ${want}`, (changes.get(`(none) → ${want}`) || 0) + 1);
            continue;
        }
        if (feedback.recommendation === want) {
            unchanged++;
            continue;
        }
        await prisma.feedback.update({
            where: { id: feedback.id },
            data: {
                recommendation: want,
                rating: want === 'NO_HIRE' ? 2 : want === 'ON_HOLD' ? 3 : 4,
            },
        });
        updated++;
        const key = `${feedback.recommendation} → ${want}`;
        changes.set(key, (changes.get(key) || 0) + 1);
    }
    const l1RejectIds = candidates
        .filter((c) => c.status === 'L1_INTERVIEW_REJECT')
        .map((c) => c.id);
    const stillWrong = await prisma.feedback.count({
        where: {
            candidateId: { in: l1RejectIds },
            recommendation: { in: ['HIRE', 'STRONG_HIRE'] },
        },
    });
    console.log(`Interviews scanned: ${interviews.length}`);
    console.log(`Feedback updated: ${updated}`);
    console.log(`Feedback created: ${created}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`L1_INTERVIEW_REJECT still with HIRE feedback: ${stillWrong}`);
    console.log('Top changes:', [...changes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15));
}
