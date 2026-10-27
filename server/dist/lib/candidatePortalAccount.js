import { BCRYPT_ROUNDS } from './passwordPolicy.js';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma.js';
import { generateTempPassword } from './password.js';
import { bumpTokenVersionAndRevoke } from './sessionTokens.js';
/**
 * Gives the candidate a portal login for their offer. The password is random and single-use
 * (they must change it at first sign-in), and is only delivered to the candidate's own email.
 * Emailing it counts as proof of the address, and any older sessions on the account are revoked.
 */
export async function ensureCandidatePortalAccount(candidate) {
    const email = candidate.email.trim().toLowerCase();
    if (!email) {
        return { ok: false, error: 'Candidate must have an email address before the offer can be sent.' };
    }
    const password = generateTempPassword();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const phoneNumber = candidate.phone?.trim() || undefined;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        if (existing.role !== 'CANDIDATE') {
            return {
                ok: false,
                error: 'This email is already registered to a non-candidate account. Use a different candidate email.',
            };
        }
        await prisma.user.update({
            where: { id: existing.id },
            data: {
                passwordHash,
                mustChangePassword: true,
                emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
                failedLoginAttempts: 0,
                lockedAt: null,
                ...(phoneNumber ? { phoneNumber } : {}),
                name: candidate.name.trim() || existing.name,
                status: 'ACTIVE',
            },
        });
        await bumpTokenVersionAndRevoke(existing.id);
        return { ok: true, created: false, password };
    }
    await prisma.user.create({
        data: {
            email,
            passwordHash,
            name: candidate.name.trim() || 'Candidate',
            role: 'CANDIDATE',
            status: 'ACTIVE',
            department: 'Candidate',
            phoneNumber: phoneNumber ?? null,
            authProvider: 'local',
            mustChangePassword: true,
            emailVerifiedAt: new Date(),
        },
    });
    return { ok: true, created: true, password };
}
