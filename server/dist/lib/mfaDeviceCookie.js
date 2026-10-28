import { env } from '../config/env.js';
import { TRUSTED_DEVICE_TTL_MS } from './mfa.js';
import { readCookie } from './refreshCookie.js';
/**
 * "Remember this device" token for MFA. It lives only in an HttpOnly cookie on the auth routes,
 * so script on the page (XSS) cannot read it and replay it to skip the second factor.
 */
const MFA_DEVICE_COOKIE = 'stitch_mfa_device';
function cookieOptions() {
    return {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: 'strict',
        path: '/api/auth',
    };
}
export function setMfaDeviceCookie(res, deviceToken) {
    res.cookie(MFA_DEVICE_COOKIE, deviceToken, { ...cookieOptions(), maxAge: TRUSTED_DEVICE_TTL_MS });
}
export function readMfaDeviceCookie(req) {
    return readCookie(req, MFA_DEVICE_COOKIE);
}
