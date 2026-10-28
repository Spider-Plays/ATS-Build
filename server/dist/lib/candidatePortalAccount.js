import { prisma } from './prisma.js';
import { createPasswordSetupLink } from './passwordReset.js';
import { unusablePasswordHash } from './legacyImport/unusablePassword.js';
/**
 * Gives the candidate a portal login for their offer. A new account gets a single-use link to
 * choose a password (sent only to the candidate's own email); no password is ever emailed. An
 * existing account keeps its password and sessions: the candidate simply signs in.
 */
export async function ensureCandidatePortalAccount(candidate) {
    const email = candidate.email.trim().toLowerCase();
    if (!email) {
        return { ok: false, error: 'Candidate must have an email address before the offer can be sent.' };
    }
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
                ...(phoneNumber ? { phoneNumber } : {}),
                name: candidate.name.trim() || existing.name,
                status: 'ACTIVE',
            },
        });
        return { ok: true, created: false };
    }
    // Email is verified when the candidate uses the link (see /auth/reset-password).
    const user = await prisma.user.create({
        data: {
            email,
            passwordHash: await unusablePasswordHash(),
            name: candidate.name.trim() || 'Candidate',
            role: 'CANDIDATE',
            status: 'ACTIVE',
            department: 'Candidate',
            phoneNumber: phoneNumber ?? null,
            authProvider: 'local',
        },
    });
    return { ok: true, created: true, setupUrl: await createPasswordSetupLink(user) };
}
