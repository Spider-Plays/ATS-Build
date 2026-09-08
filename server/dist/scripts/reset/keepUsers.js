/**
 * Wipe hiring data but keep all users.
 *
 *   $env:CONFIRM_WIPE_KEEP_USERS='yes'
 *   npm run db:reset -- keep-users
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { ensureChangeRequestTable } from '../../lib/ensureChangeRequestTable.js';
import { ensureClientDealTable } from '../../lib/ensureClientDealTable.js';
import { refuseProductionUnlessForced, requireEnvConfirm, targetDbLabel } from './safety.js';
export async function run(argv = []) {
    refuseProductionUnlessForced(argv, 'wipe');
    requireEnvConfirm('CONFIRM_WIPE_KEEP_USERS');
    console.log(`Wiping hiring data (keeping users) on ${targetDbLabel()}…`);
    await ensureChangeRequestTable();
    await ensureClientDealTable();
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
        prisma.vendorOnboarding.deleteMany(),
        prisma.vendor.deleteMany(),
    ]);
    const [users, requirements, candidates, vendors] = await Promise.all([
        prisma.user.count(),
        prisma.requirement.count(),
        prisma.candidate.count(),
        prisma.vendor.count(),
    ]);
    console.log('Done.');
    console.log(`  Users kept: ${users}`);
    console.log(`  Requirements: ${requirements}`);
    console.log(`  Candidates: ${candidates}`);
    console.log(`  Vendors: ${vendors}`);
}
