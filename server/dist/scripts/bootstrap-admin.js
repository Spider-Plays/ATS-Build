import '../config/loadEnv.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
async function main() {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    const name = process.env.ADMIN_NAME?.trim() || 'Administrator';
    const role = process.env.ADMIN_ROLE?.trim().toUpperCase() || 'ADMIN';
    if (!email || !password) {
        console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.');
        process.exit(1);
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.upsert({
        where: { email },
        update: {
            name,
            passwordHash,
            role,
            status: 'ACTIVE',
            department: 'Operations',
            mustChangePassword: false,
            passwordResetToken: null,
            passwordResetExpires: null,
        },
        create: {
            email,
            passwordHash,
            name,
            role,
            department: 'Operations',
            status: 'ACTIVE',
            permissions: '[]',
            themePreference: 'light',
            authProvider: 'local',
            mustChangePassword: false,
        },
    });
    console.log(`${role} ready: ${user.email}`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
