import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { bumpTokenVersionAndRevoke } from './sessionTokens.js';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
/** Accept the previous, current and next time step to tolerate clock drift. */
const TOTP_WINDOW = 1;
export const MFA_TOKEN_TTL = '5m';
export const MFA_MAX_FAILED_ATTEMPTS = 5;
export const TRUSTED_DEVICE_TTL_MS = 15 * 24 * 60 * 60 * 1000;
const BACKUP_CODE_COUNT = 10;
/** Every account except candidates must use a second factor (when enforcement is on). */
export function mfaRequiredForRole(role) {
    return env.mfaEnforced && role !== 'CANDIDATE';
}
// ── Secret encryption (AES-256-GCM) ─────────────────────────────────────────
export function encryptSecret(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', env.mfaEncryptionKey, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function decryptSecret(stored) {
    const [iv, tag, enc] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', env.mfaEncryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
// ── TOTP (RFC 6238, SHA-1, 6 digits, 30s) ───────────────────────────────────
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0)
        out += BASE32[(value << (5 - bits)) & 31];
    return out;
}
function base32Decode(str) {
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const ch of str.replace(/=+$/, '').toUpperCase()) {
        const idx = BASE32.indexOf(ch);
        if (idx === -1)
            continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}
export function generateTotpSecret() {
    return base32Encode(crypto.randomBytes(20));
}
function hotp(secret, counter) {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin = ((hmac[offset] & 0x7f) << 24) |
        (hmac[offset + 1] << 16) |
        (hmac[offset + 2] << 8) |
        hmac[offset + 3];
    return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}
function safeEqual(a, b) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
/**
 * Returns the matched time step, or null. Steps at or before `lastStep` are rejected so a
 * code that was already used (or sniffed after use) cannot be replayed.
 */
export function verifyTotp(secret, code, lastStep) {
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean))
        return null;
    const current = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
    for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
        const step = current + offset;
        if (lastStep != null && step <= lastStep)
            continue;
        if (safeEqual(hotp(secret, step), clean))
            return step;
    }
    return null;
}
export async function buildEnrolment(email, secret) {
    const otpauthUrl = `otpauth://totp/${encodeURIComponent(`${env.appName}:${email}`)}` +
        `?secret=${secret}&issuer=${encodeURIComponent(env.appName)}` +
        `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 224 });
    return { otpauthUrl, qrDataUrl, secret };
}
export function signMfaToken(userId, purpose) {
    return jwt.sign({ userId, purpose, typ: 'mfa' }, env.jwtSecret, { expiresIn: MFA_TOKEN_TTL });
}
export function readMfaToken(token) {
    try {
        const p = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
        if (p.typ !== 'mfa' || !p.userId)
            return null;
        if (p.purpose !== 'verify' && p.purpose !== 'setup')
            return null;
        return { userId: p.userId, purpose: p.purpose };
    }
    catch {
        return null;
    }
}
// ── Backup codes ────────────────────────────────────────────────────────────
function hashCode(code) {
    return crypto.createHash('sha256').update(normaliseBackupCode(code)).digest('hex');
}
export function normaliseBackupCode(code) {
    return code.replace(/[\s-]/g, '').toUpperCase();
}
export function looksLikeBackupCode(code) {
    return /^[A-Z0-9]{10}$/.test(normaliseBackupCode(code)) && !/^\d{6}$/.test(code.trim());
}
/** Replaces all existing codes with a fresh set and returns the plain codes (shown once). */
export async function regenerateBackupCodes(userId) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => {
        const raw = Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join('');
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await prisma.$transaction([
        prisma.mfaBackupCode.deleteMany({ where: { userId } }),
        prisma.mfaBackupCode.createMany({
            data: codes.map((c) => ({ userId, codeHash: hashCode(c) })),
        }),
    ]);
    return codes;
}
/** Atomically burns a backup code; true only for the request that consumed it. */
export async function consumeBackupCode(userId, code) {
    const res = await prisma.mfaBackupCode.updateMany({
        where: { userId, codeHash: hashCode(code), usedAt: null },
        data: { usedAt: new Date() },
    });
    return res.count === 1;
}
export function countRemainingBackupCodes(userId) {
    return prisma.mfaBackupCode.count({ where: { userId, usedAt: null } });
}
// ── Trusted devices ("remember this device for 15 days") ────────────────────
function hashDeviceToken(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
}
export async function issueTrustedDevice(userId, req) {
    const raw = crypto.randomBytes(32).toString('base64url');
    await prisma.trustedDevice.create({
        data: {
            userId,
            tokenHash: hashDeviceToken(raw),
            expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS),
            userAgent: req.headers['user-agent']?.slice(0, 400) ?? null,
        },
    });
    return raw;
}
export async function isTrustedDevice(userId, raw) {
    if (!raw)
        return false;
    const row = await prisma.trustedDevice.findUnique({ where: { tokenHash: hashDeviceToken(raw) } });
    return Boolean(row && row.userId === userId && row.expiresAt.getTime() > Date.now());
}
// ── Shared account operations ───────────────────────────────────────────────
/**
 * Checks a TOTP or backup code for a fully enrolled user. Advances the replay counter on
 * success. Wrong codes count toward a lockout (5) that a correct password cannot reset.
 */
export async function checkSecondFactor(user, code) {
    if (!user.mfaSecretEnc)
        return false;
    if (looksLikeBackupCode(code))
        return consumeBackupCode(user.id, code);
    const step = verifyTotp(decryptSecret(user.mfaSecretEnc), code, user.mfaLastStep);
    if (step === null)
        return false;
    // Only the request that advances the step wins; a concurrent replay of the same code loses.
    const res = await prisma.user.updateMany({
        where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
        data: { mfaLastStep: step },
    });
    return res.count === 1;
}
/** Records a wrong code. Returns true when the account has just been locked. */
export async function recordMfaFailure(userId) {
    const updated = await prisma.user.update({
        where: { id: userId },
        data: { mfaFailedAttempts: { increment: 1 } },
        select: { mfaFailedAttempts: true },
    });
    if (updated.mfaFailedAttempts < MFA_MAX_FAILED_ATTEMPTS)
        return false;
    // Lock new sign-ins only; existing sessions belong to the real user, not to whoever is guessing.
    await prisma.user.update({ where: { id: userId }, data: { lockedAt: new Date() } });
    return true;
}
export async function clearMfaFailures(userId) {
    await prisma.user.update({ where: { id: userId }, data: { mfaFailedAttempts: 0 } });
}
export function revokeTrustedDevices(userId) {
    return prisma.trustedDevice.deleteMany({ where: { userId } });
}
/** Developer-initiated reset ("lost my phone"): the user re-enrols at next sign-in. */
export async function resetUserMfa(userId) {
    await prisma.$transaction([
        prisma.user.update({
            where: { id: userId },
            data: {
                mfaEnabled: false,
                mfaSecretEnc: null,
                mfaPendingSecretEnc: null,
                mfaEnrolledAt: null,
                mfaLastStep: null,
                mfaFailedAttempts: 0,
            },
        }),
        prisma.mfaBackupCode.deleteMany({ where: { userId } }),
        prisma.trustedDevice.deleteMany({ where: { userId } }),
    ]);
    await bumpTokenVersionAndRevoke(userId);
}
