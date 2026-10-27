import { env } from '../config/env.js';
import { REFRESH_TOKEN_TTL_MS } from './sessionTokens.js';
/**
 * The refresh token lives only in an HttpOnly cookie, so script on the page (XSS) cannot read it.
 * SameSite=Strict keeps it off cross-site requests, and the path limits it to the auth routes.
 */
export const REFRESH_COOKIE = 'stitch_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';
/** Cookie-authenticated auth calls must send this header. A cross-site form cannot set it. */
export const CSRF_HEADER = 'x-stitch-csrf';
function cookieOptions() {
    return {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
    };
}
export function setRefreshCookie(res, refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions(), maxAge: REFRESH_TOKEN_TTL_MS });
}
export function clearRefreshCookie(res) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
}
export function readRefreshCookie(req) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1 || part.slice(0, eq).trim() !== REFRESH_COOKIE)
            continue;
        try {
            return decodeURIComponent(part.slice(eq + 1).trim()) || null;
        }
        catch {
            return null;
        }
    }
    return null;
}
/** Sets the refresh cookie and returns the session without the refresh token, for the JSON body. */
export function withRefreshCookie(res, session) {
    const { refreshToken, ...rest } = session;
    setRefreshCookie(res, refreshToken);
    return rest;
}
