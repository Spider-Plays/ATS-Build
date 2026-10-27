import crypto from 'node:crypto';
import { env } from '../config/env.js';
/** RSVP links stay valid until a day after the interview (or 30 days when no time is given). */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GRACE_AFTER_INTERVIEW_MS = 24 * 60 * 60 * 1000;
/** Separate key derived from the JWT secret so RSVP tokens and session tokens never share a key. */
function rsvpKey() {
    return crypto.createHmac('sha256', env.jwtSecret).update('interview-rsvp:v2').digest();
}
function sign(payload) {
    return crypto.createHmac('sha256', rsvpKey()).update(payload).digest('base64url');
}
export function interviewRsvpUrl(interviewId, email, response, scheduledAt) {
    const exp = scheduledAt
        ? scheduledAt.getTime() + GRACE_AFTER_INTERVIEW_MS
        : Date.now() + DEFAULT_TTL_MS;
    const payload = Buffer.from(JSON.stringify({ interviewId, email: email.trim().toLowerCase(), response, exp })).toString('base64url');
    const origin = env.clientOrigin.replace(/\/$/, '');
    return `${origin}/api/interview-rsvp?token=${encodeURIComponent(`${payload}.${sign(payload)}`)}`;
}
export function readInterviewRsvpToken(token) {
    const [payload, sig] = token.split('.');
    if (!payload || !sig)
        return null;
    const a = Buffer.from(sig);
    const b = Buffer.from(sign(payload));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
        return null;
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!parsed.interviewId || !parsed.email || (parsed.response !== 'accept' && parsed.response !== 'decline')) {
            return null;
        }
        if (typeof parsed.exp !== 'number' || parsed.exp < Date.now())
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
