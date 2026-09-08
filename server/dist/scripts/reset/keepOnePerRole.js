/**
 * Wipe application data on QA/staging; keep exactly one user per role.
 *
 *   $env:ATS_ENV='staging'
 *   $env:CONFIRM_QA_RESET='yes'
 *   npm run db:reset -- keep-one-per-role
 */
import '../../config/loadEnv.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { DEV_PASSWORD, DEV_USERS } from '../../config/devUsers.js';
import { syncDefaultSkillCatalog } from '../../lib/skillCatalog.js';
import { refuseProductionUnlessForced, requireEnvConfirm, targetDbLabel } from './safety.js';
const ROLES_TO_KEEP = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
    'FINANCE_HEAD',
    'RECRUITER',
    'TEAM_LEAD',
    'HIRING_MANAGER',
    'ACCOUNT_MANAGER',
    'INTERVIEWER',
    'VENDOR',
    'EMPLOYEE',
    'CANDIDATE',
];
/** Display name = role label only (no personal names). */
function roleDisplayName(role) {
    return role
        .split('_')
        .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
        .join(' ');
}
function primaryEmailForRole(role) {
    const primary = DEV_USERS.find((u) => u.role === role && u.primary);
    if (primary)
        return primary.email.toLowerCase();
    const any = DEV_USERS.find((u) => u.role === role);
    return any?.email.toLowerCase();
}
function fallbackEmailForRole(role) {
    return `${role.toLowerCase().replace(/_/g, '')}@stitch-ats.in`;
}
async function resolveKeepUserIds() {
    const keepByRole = new Map();
    for (const role of ROLES_TO_KEEP) {
        const preferredEmail = primaryEmailForRole(role);
        let user = preferredEmail != null
            ? await prisma.user.findFirst({ where: { email: preferredEmail, role } })
            : null;
        if (!user) {
            user = await prisma.user.findFirst({
                where: { role },
                orderBy: { createdAt: 'asc' },
            });
        }
        if (user)
            keepByRole.set(role, user.id);
    }
    return keepByRole;
}
async function ensureMissingRoleUsers(keepByRole) {
    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
    for (const role of ROLES_TO_KEEP) {
        if (keepByRole.has(role))
            continue;
        const template = DEV_USERS.find((u) => u.role === role && u.primary) ?? DEV_USERS.find((u) => u.role === role);
        const email = (template?.email ?? fallbackEmailForRole(role)).toLowerCase();
        const department = template && 'department' in template
            ? template.department
            : role === 'FINANCE_HEAD'
                ? 'Finance'
                : undefined;
        const created = await prisma.user.create({
            data: {
                email,
                passwordHash,
                name: roleDisplayName(role),
                role,
                department,
                status: 'ACTIVE',
                permissions: '[]',
                themePreference: 'light',
                authProvider: 'local',
            },
        });
        keepByRole.set(role, created.id);
        console.log(`  Created missing user: ${created.email} (${role})`);
    }
}
async function renameKeptUsersToRoleNames(keepByRole) {
    for (const [role, id] of keepByRole) {
        await prisma.user.update({
            where: { id },
            data: { name: roleDisplayName(role) },
        });
    }
}
export async function run(argv = []) {
    refuseProductionUnlessForced(argv, 'QA role reset');
    requireEnvConfirm('CONFIRM_QA_RESET');
    console.log(`Resetting QA data on ${targetDbLabel()}...`);
    console.log('Keeping one user per role:');
    const keepByRole = await resolveKeepUserIds();
    await ensureMissingRoleUsers(keepByRole);
    await renameKeptUsersToRoleNames(keepByRole);
    const keepIds = [...new Set(keepByRole.values())];
    for (const [role, id] of keepByRole) {
        const u = await prisma.user.findUnique({ where: { id }, select: { email: true, name: true } });
        console.log(`  ${role}: ${u?.email ?? id} (${u?.name ?? '?'})`);
    }
    await prisma.user.updateMany({
        where: { id: { in: keepIds } },
        data: {
            vendorId: null,
            mustChangePassword: false,
            passwordResetToken: null,
            passwordResetExpires: null,
            status: 'ACTIVE',
        },
    });
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
        prisma.loginHistory.deleteMany({ where: { userId: { notIn: keepIds } } }),
        prisma.vendor.deleteMany(),
        prisma.skillCatalog.deleteMany(),
        prisma.departmentCatalog.deleteMany(),
        prisma.clientCatalog.deleteMany(),
        prisma.interviewPanelLevel.deleteMany(),
        prisma.appSetting.deleteMany(),
        prisma.rolePageAccess.deleteMany(),
        prisma.user.deleteMany({ where: { id: { notIn: keepIds } } }),
    ]);
    const skillsAdded = await syncDefaultSkillCatalog();
    const skillCount = await prisma.skillCatalog.count();
    const [users, requirements, businessReqs, clientDeals, candidates] = await Promise.all([
        prisma.user.count(),
        prisma.requirement.count(),
        prisma.businessRequirement.count(),
        prisma.clientDeal.count(),
        prisma.candidate.count(),
    ]);
    console.log('\nQA reset complete.');
    console.log(`  Users remaining: ${users} (expected ${ROLES_TO_KEEP.length} or fewer if FINANCE_HEAD missing)`);
    console.log(`  Client deals: ${clientDeals}`);
    console.log(`  Business requirements: ${businessReqs}`);
    console.log(`  Requirements: ${requirements}`);
    console.log(`  Candidates: ${candidates}`);
    console.log(`  Skill catalog: ${skillCount} (${skillsAdded} seeded)`);
    console.log(`\nDev password for seeded accounts: ${DEV_PASSWORD}`);
}
