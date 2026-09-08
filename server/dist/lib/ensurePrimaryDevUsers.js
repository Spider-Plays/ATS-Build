import bcrypt from 'bcryptjs';
import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { DEV_PASSWORD, DEV_USERS } from '../config/devUsers.js';
/** Ensures primary dev registry users exist (non-production only). */
export async function ensurePrimaryDevUsers() {
    if (env.isProduction)
        return;
    const primaryUsers = DEV_USERS.filter((u) => u.primary);
    if (primaryUsers.length === 0)
        return;
    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
    const missing = [];
    for (const user of primaryUsers) {
        const email = user.email.toLowerCase();
        const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (!existing)
            missing.push(user);
    }
    if (missing.length === 0)
        return;
    await Promise.all(missing.map((user) => prisma.user.create({
        data: {
            email: user.email.toLowerCase(),
            passwordHash,
            name: user.name,
            role: user.role,
            department: user.department,
            status: 'ACTIVE',
            permissions: '[]',
            themePreference: 'light',
            authProvider: 'local',
        },
    }).then(() => {
        console.log(`[dev] Created missing primary user ${user.email} (${user.role})`);
    })));
}
