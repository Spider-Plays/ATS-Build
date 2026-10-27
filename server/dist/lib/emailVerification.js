import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';
import { sendEmailVerificationEmail } from '../services/email.js';
const TTL_MS = 24 * 60 * 60 * 1000;
/** Separate key derived from the JWT secret so verification tokens and session tokens never share a key. */
function verifyKey() {
    return crypto.createHmac('sha256', env.jwtSecret).update('email-verify:v1').digest();
}
function sign(payload) {
    return crypto.createHmac('sha256', verifyKey()).update(payload).digest('base64url');
}
export function emailVerificationUrl(user) {
    const payload = Buffer.from(JSON.stringify({ userId: user.id, email: user.email.trim().toLowerCase(), exp: Date.now() + TTL_MS })).toString('base64url');
    const origin = env.clientOrigin.replace(/\/$/, '');
    return `${origin}/api/auth/verify-email?token=${encodeURIComponent(`${payload}.${sign(payload)}`)}`;
}
export function readEmailVerificationToken(token) {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined)
        return null;
    const a = Buffer.from(signature);
    const b = Buffer.from(sign(payload));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
        return null;
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof parsed.userId !== 'string' || typeof parsed.email !== 'string' || typeof parsed.exp !== 'number')
            return null;
        if (parsed.exp < Date.now())
            return null;
        return { userId: parsed.userId, email: parsed.email, exp: parsed.exp };
    }
    catch {
        return null;
    }
}
export async function sendEmailVerification(user) {
    return sendEmailVerificationEmail({ to: user.email, name: user.name, verifyUrl: emailVerificationUrl(user) });
}
/** Marks the account's email as verified. Idempotent. */
export async function markEmailVerified(userId) {
    await prisma.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
}
