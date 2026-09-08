import { prisma } from './prisma.js';
import { getClientIp, getUserAgent } from './requestMeta.js';
export async function recordUserLogin(userId, req) {
    const now = new Date();
    await prisma.$transaction([
        prisma.user.update({
            where: { id: userId },
            data: { lastLogin: now },
        }),
        prisma.loginHistory.create({
            data: {
                userId,
                loggedInAt: now,
                ipAddress: getClientIp(req),
                userAgent: getUserAgent(req),
            },
        }),
    ]);
}
