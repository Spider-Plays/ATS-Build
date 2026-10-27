import { prisma } from './prisma.js';
import { withRefreshCookie } from './refreshCookie.js';
import { mapUser } from '../utils/mappers.js';
import { getAllowedPagesForRole } from './pageAccess.js';
import { recordUserLogin } from './recordLogin.js';
import { issueSession } from './sessionTokens.js';
/**
 * Records the login, sets the refresh cookie and returns the access token + user payload
 * every sign-in path responds with.
 */
export async function issueAppSession(userId, req, res) {
    const loginHistoryId = await recordUserLogin(userId, req);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user)
        throw new Error('User not found');
    const { userId: _userId, ...tokens } = await issueSession({
        id: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion ?? 0,
    }, req);
    const allowedPages = await getAllowedPagesForRole(user.role);
    return { ...withRefreshCookie(res, tokens), user: mapUser(user), allowedPages, loginHistoryId };
}
