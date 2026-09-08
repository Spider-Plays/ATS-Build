import bcrypt from 'bcryptjs';
import { prisma } from './prisma.js';
const MIN_PORTAL_PASSWORD_LENGTH = 8;
/** Digits-only phone string used as the candidate portal password. */
export function normalizePhoneForPortalPassword(phone) {
    if (!phone?.trim())
        return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < MIN_PORTAL_PASSWORD_LENGTH)
        return null;
    return digits;
}
export async function ensureCandidatePortalAccount(candidate) {
    const email = candidate.email.trim().toLowerCase();
    if (!email) {
        return { ok: false, error: 'Candidate must have an email address before the offer can be sent.' };
    }
    const password = normalizePhoneForPortalPassword(candidate.phone);
    if (!password) {
        return {
            ok: false,
            error: 'Candidate must have a valid phone number (at least 8 digits) before the offer can be sent.',
        };
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    const passwordHash = await bcrypt.hash(password, 10);
    const phoneDigits = candidate.phone?.trim() || password;
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
                phoneNumber: phoneDigits,
                name: candidate.name.trim() || existing.name,
                status: 'ACTIVE',
            },
        });
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
            phoneNumber: phoneDigits,
            authProvider: 'local',
        },
    });
    return { ok: true, created: true, password };
}
