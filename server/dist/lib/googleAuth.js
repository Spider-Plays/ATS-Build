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
    // Required audience check: the token must have been issued to this app, not any Google app.
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!infoRes.ok) {
        throw new Error('Could not verify Google token audience');
    }
    const info = (await infoRes.json());
    if (info.aud !== env.googleClientId && info.azp !== env.googleClientId) {
        throw new Error('Google token audience mismatch');
    }
    if (info.sub && info.sub !== data.sub) {
        throw new Error('Google token subject mismatch');
    }
    return {
        googleId: data.sub,
        email: data.email.toLowerCase(),
        name: (data.name || data.email.split('@')[0] || 'Candidate').trim(),
        picture: data.picture,
    };
}
