import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { excludeLanIpOrigins, isPrivateOrLocalOrigin, parseClientOrigins } from './appUrl.js';
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const envPath = path.join(workspaceRoot, '.env');
const isProduction = process.env.NODE_ENV === 'production';
function databaseUrlHost(url) {
    if (!url?.trim())
        return null;
    try {
        return new URL(url).hostname;
    }
    catch {
        return null;
    }
}
dotenv.config({ path: envPath, override: !isProduction });
/**
 * Generate JWT_SECRET / MFA_ENCRYPTION_KEY when blank and persist them to .env, so they survive
 * restarts (a lost MFA key forces every user to re-enrol; a new JWT secret signs everyone out).
 */
function ensureGeneratedSecrets() {
    const generators = {
        JWT_SECRET: () => crypto.randomBytes(48).toString('base64url'),
        MFA_ENCRYPTION_KEY: () => crypto.randomBytes(32).toString('hex'),
    };
    const missing = Object.keys(generators).filter((key) => !process.env[key]?.trim());
    if (missing.length === 0)
        return;
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    for (const key of missing) {
        const value = generators[key]();
        process.env[key] = value;
        const line = new RegExp(`^${key}=.*$`, 'm');
        content = line.test(content)
            ? content.replace(line, `${key}=${value}`)
            : `${content.replace(/\s*$/, '')}\n${key}=${value}\n`;
    }
    try {
        fs.writeFileSync(envPath, content);
        console.warn(`[env] Generated ${missing.join(', ')} and saved to ${envPath}`);
    }
    catch (err) {
        console.warn(`[env] Generated ${missing.join(', ')} for this run but could not save to .env:`, err);
    }
}
ensureGeneratedSecrets();
/** In production, process env wins — unless APP_URL is a LAN IP and .env has the public site. */
function preferPublicAppUrlFromDotenv() {
    if (!fs.existsSync(envPath))
        return;
    let fileEnv;
    try {
        fileEnv = dotenv.parse(fs.readFileSync(envPath));
    }
    catch {
        return;
    }
    const fileAppUrl = fileEnv.APP_URL?.trim().replace(/\/$/, '');
    const processAppUrl = process.env.APP_URL?.trim().replace(/\/$/, '');
    if (fileAppUrl &&
        !isPrivateOrLocalOrigin(fileAppUrl) &&
        (!processAppUrl || isPrivateOrLocalOrigin(processAppUrl))) {
        process.env.APP_URL = fileAppUrl;
    }
    const fileOrigins = parseClientOrigins(fileEnv.CLIENT_ORIGIN || '');
    if (fileOrigins.length === 0)
        return;
    const merged = excludeLanIpOrigins([
        ...new Set([...fileOrigins, ...parseClientOrigins(process.env.CLIENT_ORIGIN || '')]),
    ]);
    process.env.CLIENT_ORIGIN = merged.join(',');
}
preferPublicAppUrlFromDotenv();
if (!isProduction) {
    const host = databaseUrlHost(process.env.DATABASE_URL);
    console.log(`[env] Single root .env loaded${host ? ` -> ${host}` : ''}`);
}
export function databaseHostLabel() {
    return databaseUrlHost(process.env.DATABASE_URL);
}
