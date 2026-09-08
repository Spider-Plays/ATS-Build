import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma.js';
import { env } from '../config/env.js';
export const ACCESS_TOKEN_EXPIRES = '15m';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function hashRefreshToken(raw) {
    return crypto.createHash('sha256').update(raw).digest('hex');
}
function newRefreshSecret() {
    return crypto.randomBytes(32).toString('base64url');
}
export function signAccessToken(payload) {
    return jwt.sign({
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        tokenVersion: payload.tokenVersion,
        typ: 'access',
    }, env.jwtSecret, { expiresIn: ACCESS_TOKEN_EXPIRES });
}
export async function issueSession(user, req, familyId) {
    const token = signAccessToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion ?? 0,
    });
    const rawRefresh = newRefreshSecret();
    const family = familyId || crypto.randomUUID();
    await prisma.refreshToken.create({
        data: {
            userId: user.id,
            tokenHash: hashRefreshToken(rawRefresh),
            familyId: family,
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
            userAgent: req.headers['user-agent']?.slice(0, 400) ?? null,
        },
    });
    return { token, refreshToken: rawRefresh, expiresIn: 15 * 60, userId: user.id };
}
export async function revokeAllRefreshTokens(userId) {
    await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
export async function bumpTokenVersionAndRevoke(userId) {
    const updated = await prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
    });
    await revokeAllRefreshTokens(userId);
    return updated.tokenVersion;
}
export async function rotateRefreshToken(rawRefresh, req) {
    const tokenHash = hashRefreshToken(rawRefresh);
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing)
        return { error: 'invalid' };
    if (existing.revokedAt) {
        await prisma.refreshToken.updateMany({
            where: { familyId: existing.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        return { error: 'reuse' };
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
        await prisma.refreshToken.update({
            where: { id: existing.id },
            data: { revokedAt: new Date() },
        });
        return { error: 'invalid' };
    }
    const user = await prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user || user.status === 'DISABLED')
        return { error: 'invalid' };
    const next = await issueSession({
        id: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion ?? 0,
    }, req, existing.familyId);
    const nextHash = hashRefreshToken(next.refreshToken);
    const nextRow = await prisma.refreshToken.findUnique({ where: { tokenHash: nextHash } });
    await prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedById: nextRow?.id ?? null },
    });
    return next;
}
export async function revokeRefreshToken(rawRefresh) {
    const tokenHash = hashRefreshToken(rawRefresh);
    await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
