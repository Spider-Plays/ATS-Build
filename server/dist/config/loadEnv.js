import dotenv from 'dotenv';
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
