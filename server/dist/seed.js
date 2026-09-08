import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma.js';
import { withDbRetry } from './lib/dbRetry.js';
import { removeLegacyDevUsers } from './lib/legacyDevUsers.js';
import { env } from './config/env.js';
import { DEV_PASSWORD, DEV_USERS } from './config/devUsers.js';
import { SEED_USERS } from './config/users.js';
const PRIMARY_ONLY = process.argv.includes('--primary');
async function upsertDevUser(u, vendorId) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
        where: { email: u.email.toLowerCase() },
        update: {
            name: u.name,
            role: u.role,
            department: 'department' in u ? u.department : undefined,
            passwordHash,
            status: 'ACTIVE',
            ...(vendorId !== undefined && { vendorId }),
        },
        create: {
            email: u.email.toLowerCase(),
            passwordHash,
            name: u.name,
            role: u.role,
            department: 'department' in u ? u.department : undefined,
            status: 'ACTIVE',
            permissions: '[]',
            themePreference: 'light',
            authProvider: 'local',
            ...(vendorId !== undefined && { vendorId }),
        },
    });
}
async function main() {
    if (env.isProduction) {
        console.error('Refusing to seed dev users in production. Use npm run db:bootstrap instead.');
        process.exit(1);
    }
    if (SEED_USERS.length === 0) {
        console.log('No seed users configured. Run npm run db:bootstrap to create an admin.');
        return;
    }
    const usersToSeed = PRIMARY_ONLY
        ? DEV_USERS.filter((u) => u.primary)
        : [...SEED_USERS];
    console.log(`Seeding ${usersToSeed.length} demo user(s)...`);
    await withDbRetry(() => prisma.$queryRaw `SELECT 1`, { label: 'Neon' });
    const legacyCleanup = await removeLegacyDevUsers(prisma);
    const legacyRemoved = legacyCleanup.merged + legacyCleanup.deleted + legacyCleanup.patternDeleted;
    if (legacyRemoved > 0) {
        console.log(`Cleaned up ${legacyRemoved} legacy user account(s).`);
    }
    const hasVendor = usersToSeed.some((u) => u.role === 'VENDOR');
    let vendorId;
    if (hasVendor) {
        const vendor = await prisma.vendor.upsert({
            where: { code: 'DEV-VENDOR' },
            update: { name: 'Dev Staffing Co', status: 'ACTIVE', email: 'vendor-org@stitch-ats.in' },
            create: {
                name: 'Dev Staffing Co',
                code: 'DEV-VENDOR',
                email: 'vendor-org@stitch-ats.in',
                status: 'ACTIVE',
                contactName: 'Raghavendra Murthy',
            },
        });
        vendorId = vendor.id;
    }
    for (const u of usersToSeed) {
        await upsertDevUser(u, u.role === 'VENDOR' ? vendorId : undefined);
    }
    const userCount = await prisma.user.count();
    console.log(`Seeded ${userCount} user(s). Password for all: ${DEV_PASSWORD}`);
    console.log('Accounts:');
    for (const u of usersToSeed) {
        console.log(`  ${u.role.padEnd(16)} ${u.email}`);
    }
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
