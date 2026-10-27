/// <reference types="node" />
import process from 'node:process';
import crypto from 'node:crypto';
import './loadEnv.js';
import { m365Config } from '../integrations/m365/config.js';
import { excludeLanIpOrigins, isPrivateOrLocalOrigin, isStagingAppHost, parseClientOrigins, PRODUCTION_APP_URL, resolvePublicAppUrl, } from './appUrl.js';
const isProduction = process.env.NODE_ENV === 'production';
/**
 * Weak development fallbacks (JWT secret, derived MFA key, MFA off, seeded dev accounts) are only
 * allowed on a machine that opts in with ATS_ENV=local. "Not production" is not enough: a host
 * that forgot NODE_ENV=production must fail to start rather than run with known secrets.
 */
// NODE_TEST_CONTEXT is set by the Node test runner, so unit tests run without a .env file.
export const isLocalDev = process.env.ATS_ENV === 'local' || process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
function resolveJwtSecret() {
    const secret = process.env.JWT_SECRET?.trim();
    if (secret && secret.length >= 32)
        return secret;
    if (!isProduction && isLocalDev)
        return secret || 'dev-secret';
    throw new Error('JWT_SECRET must be set to a strong random string (32+ characters). ' +
        'For local development only, set ATS_ENV=local to allow the built-in dev secret.');
}
/** 32-byte AES key (64 hex chars) for encrypting TOTP secrets. */
function resolveMfaEncryptionKey() {
    const raw = process.env.MFA_ENCRYPTION_KEY?.trim();
    if (raw) {
        if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
            throw new Error('MFA_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
        }
        return Buffer.from(raw, 'hex');
    }
    if (isProduction || !isLocalDev) {
        throw new Error('MFA_ENCRYPTION_KEY must be set (64 hex characters). For local development only, set ATS_ENV=local.');
    }
    console.warn('[mfa] MFA_ENCRYPTION_KEY is not set — deriving a dev-only key from JWT_SECRET.');
    return crypto.createHash('sha256').update(`mfa:${resolveJwtSecret()}`).digest();
}
const isStaging = process.env.ATS_ENV === 'staging';
function defaultProductionAppUrl() {
    const explicit = process.env.APP_URL?.trim().replace(/\/$/, '');
    if (explicit && !isPrivateOrLocalOrigin(explicit) && (isStaging || !isStagingAppHost(explicit))) {
        return explicit;
    }
    return PRODUCTION_APP_URL;
}
/** Single app URL for email links — never a LAN IP or the QA site. */
function resolveClientOrigin(origins) {
    return resolvePublicAppUrl({
        appUrl: process.env.APP_URL,
        clientOrigins: origins,
        isProduction,
        isStaging,
        fallback: defaultProductionAppUrl(),
    });
}
const clientOrigins = excludeLanIpOrigins(parseClientOrigins(process.env.CLIENT_ORIGIN || process.env.APP_URL || 'http://localhost:3000'));
function resolveResendApiKey() {
    const key = (process.env.RESEND_API_KEY || '').trim();
    if (!key)
        return '';
    // Resend live keys are `re_…`. Ignore placeholders / garbage from shell env.
    if (!/^re_[A-Za-z0-9_]+/.test(key)) {
        console.warn('[email] Ignoring RESEND_API_KEY — expected a Resend key starting with re_. Prefer M365_* for Stitch ATS.');
        return '';
    }
    return key;
}
export const env = {
    isProduction,
    port: Number(process.env.PORT) || 4000,
    /** Interface the API binds to. Loopback by default: the frontend server proxies /api locally. */
    host: process.env.API_HOST?.trim() || '127.0.0.1',
    jwtSecret: resolveJwtSecret(),
    mfaEncryptionKey: resolveMfaEncryptionKey(),
    /** MFA is always enforced except on a local dev machine (ATS_ENV=local) that sets MFA_ENFORCED=false. */
    mfaEnforced: isProduction || !isLocalDev || process.env.MFA_ENFORCED?.trim().toLowerCase() !== 'false',
    clientOrigin: resolveClientOrigin(clientOrigins),
    clientOrigins,
    resendApiKey: resolveResendApiKey(),
    emailFrom: process.env.EMAIL_FROM || 'Stitch ATS <onboarding@resend.dev>',
    appName: process.env.APP_NAME || 'Stitch ATS',
    /** Daily 11:00 IST open-requisition report. Comma-separated; unset sends nothing until set here or in the app. */
    openRequisitionReportTo: (process.env.OPEN_REQUISITION_REPORT_TO || '')
        .split(/[,;]/)
        .map((address) => address.trim())
        .filter(Boolean),
    offerExecApprovalThreshold: Number(process.env.OFFER_EXEC_APPROVAL_THRESHOLD) || 2500000,
    m365: m365Config,
    /** Groq API key for the staff ATS assistant (optional — structured fallback when unset). */
    groqApiKey: process.env.GROQ_API_KEY?.trim() || '',
    groqModel: process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
    /** Google Identity Services client ID (candidate portal Sign in with Google). */
    googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || '',
    /** Microsoft Entra application settings for staff SSO. */
    microsoftClientId: process.env.MICROSOFT_CLIENT_ID?.trim() || '',
    microsoftTenantId: process.env.MICROSOFT_TENANT_ID?.trim() || '',
    /** Email domains a first Microsoft sign-in may link to an ATS user by email. Comma-separated; empty allows any. */
    microsoftAllowedEmailDomains: (process.env.MICROSOFT_ALLOWED_EMAIL_DOMAINS || '')
        .split(/[,;]/)
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    /** Folder for nightly and manual Postgres dumps. Relative paths are from the repo root. */
    databaseBackupDir: process.env.DATABASE_BACKUP_DIR?.trim() || 'backups',
};
