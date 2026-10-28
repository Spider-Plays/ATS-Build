import crypto from 'crypto';
import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { selectEmailLinkOrigin } from '../config/appUrl.js';
import { sendPasswordResetEmail } from '../services/email.js';
function requestAppOrigin(req) {
    if (!req)
        return null;
    const origin = req.get('origin');
    if (origin && origin !== 'null')
        return origin;
    const referer = req.get('referer');
    if (!referer)
        return null;
    try {
        return new URL(referer).origin;
    }
    catch {
        return null;
    }
}
const RESET_LINK_TTL_MS = 60 * 60 * 1000;
/** New accounts get a set-password link instead of an emailed password; it lasts long enough to act on. */
export const ACCOUNT_SETUP_LINK_TTL_MS = 24 * 60 * 60 * 1000;
export async function issuePasswordResetLink(user, req) {
    const resetUrl = await createPasswordSetupLink(user, req, RESET_LINK_TTL_MS);
    await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
}
/**
 * Stores a single-use token (hashed) and returns the link that lets the owner choose their own
 * password. Used for resets and for first sign-in, so no password ever has to travel by email.
 */
export async function createPasswordSetupLink(user, req, ttlMs = ACCOUNT_SETUP_LINK_TTL_MS) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + ttlMs);
    await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: hashResetToken(token), passwordResetExpires: expires },
    });
    const loginPath = user.role === 'CANDIDATE' ? '/login' : '/staffportal';
    const base = selectEmailLinkOrigin({
        configuredOrigin: env.clientOrigin,
        allowedOrigins: env.clientOrigins,
        requestOrigin: requestAppOrigin(req),
        isStaging: process.env.ATS_ENV === 'staging',
    });
    return `${base}${loginPath}?reset=${token}`;
}
/** Reset tokens are stored hashed so a database leak does not expose working reset links. */
export function hashResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
