import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
function getIssuer() {
    return `https://login.microsoftonline.com/${encodeURIComponent(env.microsoftTenantId)}/v2.0`;
}
/** Verify a Microsoft Entra ID token issued for this application and tenant. */
export async function verifyMicrosoftIdToken(idToken) {
    if (!env.microsoftClientId || !env.microsoftTenantId) {
        throw new Error('Microsoft SSO is not configured');
    }
    const issuer = getIssuer();
    const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${encodeURIComponent(env.microsoftTenantId)}/discovery/v2.0/keys`));
    const { payload } = await jwtVerify(idToken, jwks, {
        issuer,
        audience: env.microsoftClientId,
    });
    const microsoftId = typeof payload.oid === 'string' ? payload.oid : '';
    const emailClaim = payload.preferred_username || payload.email;
    const email = typeof emailClaim === 'string' ? emailClaim.trim().toLowerCase() : '';
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!microsoftId || !email)
        throw new Error('Microsoft token is missing required claims');
    return {
        microsoftId,
        email,
        name: name || email.split('@')[0] || 'Microsoft user',
    };
}
