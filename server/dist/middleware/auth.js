import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { applyNoStoreAuth, sendAuthUnauthorized } from '../lib/authResponse.js';
function forwardDbError(err, next) {
    if (err instanceof Prisma.PrismaClientInitializationError ||
        (err instanceof Prisma.PrismaClientKnownRequestError &&
            ['P1000', 'P1001', 'P1002', 'P1008', 'P1011', 'P1017'].includes(err.code))) {
        return next(err);
    }
    throw err;
}
export function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return sendAuthUnauthorized(res);
    }
    try {
        const token = header.slice(7);
        const payload = jwt.verify(token, env.jwtSecret);
        if (payload.typ !== 'access') {
            return sendAuthUnauthorized(res, 'Invalid token');
        }
        req.auth = {
            userId: payload.userId,
            email: payload.email,
            role: payload.role,
            tokenVersion: typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 0,
            typ: payload.typ,
        };
        next();
    }
    catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            applyNoStoreAuth(res);
            return res.status(401).json({ error: 'Access token expired', code: 'ACCESS_EXPIRED' });
        }
        return sendAuthUnauthorized(res, 'Invalid token');
    }
}
export function requireRoles(...roles) {
    return (req, res, next) => {
        if (!req.auth)
            return sendAuthUnauthorized(res);
        if (req.auth.role === 'SUPER_ADMIN')
            return next();
        if (!roles.includes(req.auth.role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
}
export async function requireActiveUser(req, res, next) {
    if (!req.auth)
        return sendAuthUnauthorized(res);
    try {
        const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
        if (!user || user.status === 'DISABLED') {
            return res.status(403).json({ error: 'Account disabled' });
        }
        const tokenVersion = user.tokenVersion ?? 0;
        if ((req.auth.tokenVersion ?? 0) !== tokenVersion) {
            applyNoStoreAuth(res);
            return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' });
        }
        // Authorize from the database role — JWT may be stale after role changes.
        req.auth.role = user.role;
        req.auth.email = user.email;
        req.auth.tokenVersion = tokenVersion;
        next();
    }
    catch (err) {
        forwardDbError(err, next);
    }
}
