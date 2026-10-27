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
export async function issuePasswordResetLink(user, req) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
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
    const resetUrl = `${base}${loginPath}?reset=${token}`;
    await sendPasswordResetEmail({ to: user.email, name: user.name, resetUrl });
}
/** Reset tokens are stored hashed so a database leak does not expose working reset links. */
export function hashResetToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
