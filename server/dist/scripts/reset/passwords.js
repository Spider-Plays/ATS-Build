/**
 * Reset all user passwords to the shared DEV_PASSWORD.
 *
 *   npm run db:reset -- passwords
 */
import '../../config/loadEnv.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { DEV_PASSWORD } from '../../config/devUsers.js';
export async function run(_argv = []) {
    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
    const result = await prisma.user.updateMany({
        data: {
            passwordHash,
            mustChangePassword: false,
            passwordResetToken: null,
            passwordResetExpires: null,
        },
    });
    console.log(`Reset password to "${DEV_PASSWORD}" for ${result.count} user(s).`);
}
