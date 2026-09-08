/**
 * Remove all data and users except one SUPER_ADMIN.
 *
 *   $env:CONFIRM_PRODUCTION_RESET='yes'
 *   npm run db:reset -- keep-superadmin
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { requireEnvConfirm, targetDbLabel } from './safety.js';
export async function run(_argv = []) {
    requireEnvConfirm('CONFIRM_PRODUCTION_RESET');
    const keepEmail = (process.env.KEEP_SUPER_ADMIN_EMAIL?.trim().toLowerCase() || 'superadmin@stitch-ats.in');
    const keepUser = (await prisma.user.findFirst({
        where: { email: keepEmail, role: 'SUPER_ADMIN' },
    })) ??
        (await prisma.user.findFirst({
            where: { role: 'SUPER_ADMIN' },
            orderBy: { createdAt: 'asc' },
        }));
    if (!keepUser) {
        console.error(`No SUPER_ADMIN user found (looked for ${keepEmail}). Aborting — bootstrap an admin first.`);
        process.exit(1);
    }
    console.log(`Keeping SUPER_ADMIN: ${keepUser.email} (${keepUser.name})`);
    console.log(`Database: ${targetDbLabel()}`);
    console.log('Removing all other data...');
    await prisma.$transaction([
        prisma.activityLog.deleteMany(),
        prisma.feedback.deleteMany(),
        prisma.offer.deleteMany(),
        prisma.interview.deleteMany(),
        prisma.interviewPlanStage.deleteMany(),
        prisma.interviewPlan.deleteMany(),
        prisma.candidate.deleteMany(),
        prisma.vendorRequirement.deleteMany(),
        prisma.loginHistory.deleteMany(),
        prisma.vendor.deleteMany(),
        prisma.skillCatalog.deleteMany(),
        prisma.departmentCatalog.deleteMany(),
        prisma.clientCatalog.deleteMany(),
        prisma.interviewPanelLevel.deleteMany(),
        prisma.requirement.deleteMany(),
        prisma.rolePageAccess.deleteMany(),
        prisma.user.deleteMany({ where: { id: { not: keepUser.id } } }),
    ]);
    await prisma.user.update({
        where: { id: keepUser.id },
        data: {
            status: 'ACTIVE',
            vendorId: null,
            mustChangePassword: false,
            passwordResetToken: null,
            passwordResetExpires: null,
        },
    });
    const [users, requirements, candidates] = await Promise.all([
        prisma.user.count(),
        prisma.requirement.count(),
        prisma.candidate.count(),
    ]);
    console.log('\nReset complete.');
    console.log(`  Users remaining: ${users} (${keepUser.email})`);
    console.log(`  Requirements: ${requirements}`);
    console.log(`  Candidates: ${candidates}`);
}
