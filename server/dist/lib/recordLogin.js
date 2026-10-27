import { prisma } from './prisma.js';
import { getClientIp, getUserAgent } from './requestMeta.js';
export const LOGOUT_REASONS = ['signed_out', 'idle', 'tab_closed', 'unexpected'];
export async function recordUserLogin(userId, req) {
    const now = new Date();
    await prisma.$executeRaw `
    UPDATE "LoginHistory"
    SET "loggedOutAt" = ${now}, "logoutReason" = 'unexpected'
    WHERE "userId" = ${userId} AND "loggedOutAt" IS NULL
  `;
    const entry = await prisma.loginHistory.create({
        data: {
            userId,
            loggedInAt: now,
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req),
        },
    });
    await prisma.user.update({
        where: { id: userId },
        data: { lastLogin: now },
    });
    return entry.id;
}
export async function closeLoginSession(userId, reason, loginHistoryId) {
    const now = new Date();
    if (loginHistoryId) {
        await prisma.$executeRaw `
      UPDATE "LoginHistory"
      SET "loggedOutAt" = ${now}, "logoutReason" = ${reason}
      WHERE id = ${loginHistoryId} AND "userId" = ${userId} AND "loggedOutAt" IS NULL
    `;
        return;
    }
    await prisma.$executeRaw `
    UPDATE "LoginHistory"
    SET "loggedOutAt" = ${now}, "logoutReason" = ${reason}
    WHERE "userId" = ${userId} AND "loggedOutAt" IS NULL
  `;
}
/** Undo a tab-close mark when the page reloads a few seconds later. */
export async function reopenRecentTabClose(userId, loginHistoryId) {
    const cutoff = new Date(Date.now() - 30_000);
    await prisma.$executeRaw `
    UPDATE "LoginHistory"
    SET "loggedOutAt" = NULL, "logoutReason" = NULL
    WHERE id = ${loginHistoryId}
      AND "userId" = ${userId}
      AND "logoutReason" = 'tab_closed'
      AND "loggedOutAt" >= ${cutoff}
  `;
}
export function listLoginHistory(userId) {
    return prisma.$queryRaw `
    SELECT id, "userId", "loggedInAt", "loggedOutAt", "logoutReason", "ipAddress", "userAgent"
    FROM "LoginHistory"
    WHERE "userId" = ${userId}
    ORDER BY "loggedInAt" DESC
    LIMIT 200
  `;
}
