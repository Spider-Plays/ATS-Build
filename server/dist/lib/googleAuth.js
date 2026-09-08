import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
let client = null;
function getClient() {
    if (!env.googleClientId) {
        throw new Error('GOOGLE_CLIENT_ID is not configured');
    }
    if (!client) {
        client = new OAuth2Client(env.googleClientId);
    }
    return client;
}
/** Verify a Google Identity Services ID token and return profile fields. */
export async function verifyGoogleIdToken(credential) {
    const ticket = await getClient().verifyIdToken({
        idToken: credential,
        audience: env.googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
        throw new Error('Invalid Google token payload');
    }
    if (payload.email_verified === false) {
        throw new Error('Google email is not verified');
    }
    return {
        googleId: payload.sub,
        email: payload.email.toLowerCase(),
        name: (payload.name || payload.email.split('@')[0] || 'Candidate').trim(),
        picture: payload.picture,
    };
}
/**
 * Verify a Google OAuth access token (from GIS token client + custom button)
 * via Google's userinfo endpoint, and confirm audience when present.
 */
export async function verifyGoogleAccessToken(accessToken) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
        throw new Error('Invalid Google access token');
    }
    const data = (await res.json());
    if (!data.sub || !data.email) {
        throw new Error('Invalid Google userinfo payload');
    }
    const verified = data.email_verified === true || data.email_verified === 'true';
    if (!verified) {
        throw new Error('Google email is not verified');
    }
    // Optional audience check via tokeninfo (userinfo may omit aud).
    try {
        const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
        if (infoRes.ok) {
            const info = (await infoRes.json());
            const audience = info.aud || info.azp;
            if (audience && audience !== env.googleClientId) {
                throw new Error('Google token audience mismatch');
            }
        }
    }
    catch (err) {
        if (err instanceof Error && err.message === 'Google token audience mismatch')
            throw err;
        // tokeninfo is best-effort; userinfo already authenticated the token
    }
    return {
        googleId: data.sub,
        email: data.email.toLowerCase(),
        name: (data.name || data.email.split('@')[0] || 'Candidate').trim(),
        picture: data.picture,
    };
}
