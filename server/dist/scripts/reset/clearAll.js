/**
 * Clear the entire database (all tables empty).
 *
 *   npm run db:reset -- all
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { databaseHostLabel } from '../../config/loadEnv.js';
import { assertSafeClearTarget, targetDbLabel } from './safety.js';
export async function run(_argv = []) {
    assertSafeClearTarget();
    console.log(`Clearing entire database on ${databaseHostLabel() ?? targetDbLabel()}…`);
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
        prisma.changeRequest.deleteMany(),
        prisma.loginHistory.deleteMany(),
        prisma.vendorOnboarding.deleteMany(),
        prisma.vendor.deleteMany(),
        prisma.skillCatalog.deleteMany(),
        prisma.departmentCatalog.deleteMany(),
        prisma.clientCatalog.deleteMany(),
        prisma.cityCatalog.deleteMany(),
        prisma.skillMarketRow.deleteMany(),
        prisma.locationMultiplier.deleteMany(),
        prisma.interviewPanelLevel.deleteMany(),
        prisma.requirement.deleteMany(),
        prisma.appSetting.deleteMany(),
        prisma.rolePageAccess.deleteMany(),
        prisma.user.deleteMany(),
    ]);
    const counts = await Promise.all([
        prisma.user.count(),
        prisma.requirement.count(),
        prisma.candidate.count(),
        prisma.vendor.count(),
        prisma.businessRequirement.count(),
        prisma.clientDeal.count(),
        prisma.offer.count(),
        prisma.interview.count(),
    ]);
    if (counts.some((n) => n > 0)) {
        throw new Error(`Clear incomplete: ${counts.join(', ')} remaining in core tables`);
    }
    console.log('Database cleared — all tables are empty.');
    console.log('Run `npm run db:bootstrap` or `npm run db:seed` to create login accounts again.');
}
