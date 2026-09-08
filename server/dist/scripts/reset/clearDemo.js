/**
 * Remove seeded demo / mock data; keep real QA accounts + catalogs.
 *
 *   $env:CONFIRM_DEMO_CLEAR='yes'
 *   npm run db:reset -- demo
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { ensureChangeRequestTable } from '../../lib/ensureChangeRequestTable.js';
import { ensureClientDealTable } from '../../lib/ensureClientDealTable.js';
import { refuseProductionUnlessForced, requireEnvConfirm, targetDbLabel } from './safety.js';
export async function run(argv = []) {
    refuseProductionUnlessForced(argv, 'clear demo data');
    requireEnvConfirm('CONFIRM_DEMO_CLEAR');
    const keepEmails = new Set((process.env.KEEP_DEMO_CLEAR_EMAILS ?? 'superadmin@stitch-ats.in,qa-admin@stitch-ats.in')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean));
    console.log(`Clearing demo data from ${targetDbLabel()}...`);
    if (keepEmails.size > 0) {
        console.log(`Keeping: ${[...keepEmails].join(', ')}`);
    }
    await ensureChangeRequestTable();
    await ensureClientDealTable();
    const stitchUsers = await prisma.user.findMany({
        where: {
            email: { endsWith: '@stitch-ats.in' },
            NOT: { email: { in: [...keepEmails] } },
        },
        select: { id: true, email: true },
    });
    const stitchUserIds = stitchUsers.map((u) => u.id);
    await prisma.user.updateMany({ data: { vendorId: null } });
    await prisma.$transaction([
        prisma.activityLog.deleteMany(),
        prisma.feedback.deleteMany(),
        prisma.offer.deleteMany(),
        prisma.interview.deleteMany(),
        prisma.interviewPlanStage.deleteMany(),
        prisma.interviewPlan.deleteMany(),
        prisma.candidate.deleteMany(),
        prisma.vendorRequirement.deleteMany(),
        prisma.businessRequirement.deleteMany(),
        prisma.clientDeal.deleteMany(),
        prisma.requirement.deleteMany(),
        prisma.changeRequest.deleteMany(),
        prisma.loginHistory.deleteMany({
            where: stitchUserIds.length > 0 ? { userId: { in: stitchUserIds } } : undefined,
        }),
        prisma.user.deleteMany({
            where: {
                email: { endsWith: '@stitch-ats.in' },
                NOT: { email: { in: [...keepEmails] } },
            },
        }),
        prisma.vendor.deleteMany(),
    ]);
    const [users, stitchUsersLeft, requirements, candidates, businessReqs, vendors] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { email: { endsWith: '@stitch-ats.in' } } }),
        prisma.requirement.count(),
        prisma.candidate.count(),
        prisma.businessRequirement.count(),
        prisma.vendor.count(),
    ]);
    console.log('\nDemo data cleared.');
    console.log(`  Users remaining: ${users} (${stitchUsersLeft} @stitch-ats.in kept)`);
    console.log(`  Requirements: ${requirements}`);
    console.log(`  Candidates: ${candidates}`);
    console.log(`  Business requirements: ${businessReqs}`);
    console.log(`  Vendors: ${vendors}`);
    console.log(`  Removed ${stitchUsers.length} demo @stitch-ats.in user(s).`);
}
