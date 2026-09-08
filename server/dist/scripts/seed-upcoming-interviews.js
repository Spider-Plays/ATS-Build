/**
 * Ensure several upcoming SCHEDULED interviews exist for the Interviews agenda.
 * Safe to re-run — skips candidates that already have an upcoming session.
 *
 * Usage: npx tsx src/scripts/seed-upcoming-interviews.ts
 */
import '../config/loadEnv.js';
import { prisma } from '../lib/prisma.js';
import { ensureInterviewPlan } from '../lib/interviewPlan.js';
import { devUserEmail } from '../config/devUsers.js';
const TARGET = Number(process.argv.find((a) => a.startsWith('--count='))?.slice(8) ?? 5);
async function main() {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const users = await prisma.user.findMany({
        where: {
            status: 'ACTIVE',
            role: {
                in: ['INTERVIEWER', 'HIRING_MANAGER', 'RECRUITER', 'ADMIN', 'TEAM_LEAD'],
            },
        },
        select: { id: true, email: true, role: true, name: true },
    });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
    const interviewerIds = [
        ...new Set([
            byEmail.get(devUserEmail('INTERVIEWER').toLowerCase()),
            byEmail.get(devUserEmail('HIRING_MANAGER').toLowerCase()),
            byEmail.get(devUserEmail('RECRUITER').toLowerCase()),
            byEmail.get(devUserEmail('ADMIN').toLowerCase()),
            ...users.map((u) => u.id),
        ].filter(Boolean)),
    ].slice(0, 4);
    if (interviewerIds.length === 0) {
        throw new Error('No interviewer users found. Seed users first (npm run db:seed).');
    }
    let upcoming = await prisma.interview.count({
        where: { status: 'SCHEDULED', scheduledAt: { gt: new Date() } },
    });
    console.log(`Upcoming interviews before: ${upcoming}`);
    if (upcoming >= TARGET) {
        console.log(`Already have ${upcoming} upcoming (≥ ${TARGET}). Nothing to do.`);
        return;
    }
    let candidates = await prisma.candidate.findMany({
        where: {
            requirementId: { not: null },
            status: {
                in: [
                    'L1_INTERVIEW',
                    'MANAGERIAL_INTERVIEW',
                    'CLIENT_INTERVIEW',
                    'HR_INTERVIEW',
                    'SCREEN_SELECT',
                    'TO_BE_SCREENED',
                ],
            },
        },
        orderBy: { updatedAt: 'desc' },
        take: 40,
    });
    if (candidates.length === 0) {
        throw new Error('No candidates with a job requirement found. Run: npm run db:seed-demo --prefix server');
    }
    let slot = 0;
    for (const candidate of candidates) {
        if (upcoming >= TARGET)
            break;
        if (!candidate.requirementId)
            continue;
        const hasUpcoming = await prisma.interview.findFirst({
            where: {
                candidateId: candidate.id,
                status: 'SCHEDULED',
                scheduledAt: { gt: new Date() },
            },
        });
        if (hasUpcoming)
            continue;
        const plan = await ensureInterviewPlan(candidate.requirementId);
        const stages = plan.stages;
        if (!stages.length)
            continue;
        const completedStageIds = new Set((await prisma.interview.findMany({
            where: {
                candidateId: candidate.id,
                status: 'COMPLETED',
                planStageId: { not: null },
            },
            select: { planStageId: true },
        }))
            .map((r) => r.planStageId)
            .filter(Boolean));
        const stage = stages.find((s) => !completedStageIds.has(s.id)) ?? stages[0];
        const existingForStage = await prisma.interview.findFirst({
            where: { candidateId: candidate.id, planStageId: stage.id },
        });
        const interviewerA = interviewerIds[slot % interviewerIds.length];
        const interviewerB = interviewerIds[(slot + 1) % interviewerIds.length];
        const panelIds = interviewerA === interviewerB ? [interviewerA] : [interviewerA, interviewerB];
        const scheduledAt = new Date(now + (1 + slot) * day + (9 + slot) * 60 * 60 * 1000);
        if (existingForStage) {
            await prisma.feedback.deleteMany({ where: { interviewId: existingForStage.id } });
            await prisma.interview.update({
                where: { id: existingForStage.id },
                data: {
                    scheduledAt,
                    status: 'SCHEDULED',
                    interviewerIds: JSON.stringify(panelIds),
                    meetingLink: existingForStage.meetingLink || 'https://meet.google.com/demo-stitch-ats',
                },
            });
        }
        else {
            await prisma.interview.create({
                data: {
                    candidateId: candidate.id,
                    requirementId: candidate.requirementId,
                    planStageId: stage.id,
                    scheduledAt,
                    interviewerIds: JSON.stringify(panelIds),
                    type: stage.interviewType,
                    status: 'SCHEDULED',
                    duration: stage.defaultDuration,
                    meetingLink: 'https://meet.google.com/demo-stitch-ats',
                },
            });
        }
        if (candidate.status !== 'L1_INTERVIEW' &&
            candidate.status !== 'MANAGERIAL_INTERVIEW' &&
            candidate.status !== 'CLIENT_INTERVIEW' &&
            candidate.status !== 'HR_INTERVIEW') {
            await prisma.candidate.update({
                where: { id: candidate.id },
                data: { status: 'L1_INTERVIEW' },
            });
        }
        console.log(`+ ${candidate.name} · ${stage.name} · ${scheduledAt.toLocaleString()} · panel ${panelIds.length}`);
        upcoming += 1;
        slot += 1;
    }
    const finalCount = await prisma.interview.count({
        where: { status: 'SCHEDULED', scheduledAt: { gt: new Date() } },
    });
    console.log(`Upcoming interviews after: ${finalCount}`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
