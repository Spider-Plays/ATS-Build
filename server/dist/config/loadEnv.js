import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { assertStagingDatabaseIsolation, databaseUrlHost, isProductionNeonDatabaseUrl, } from './databaseEnv.js';
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localPath = path.join(serverRoot, '.env.local');
const stagingPath = path.join(serverRoot, '.env.staging');
const igsPath = path.join(serverRoot, '.env.igs');
const defaultPath = path.join(serverRoot, '.env');
const localExists = fs.existsSync(localPath);
const stagingExists = fs.existsSync(stagingPath);
const igsExists = fs.existsSync(igsPath);
const explicitLocal = process.env.ATS_ENV === 'local';
const explicitProduction = process.env.ATS_ENV === 'production';
const explicitIgs = process.env.ATS_ENV === 'igs';
const isDeployed = process.env.NODE_ENV === 'production';
// Localhost Postgres: ATS_ENV=local → server/.env.local
// Local QA (Neon): ATS_ENV=staging → server/.env.staging (default when neither local nor prod/igs)
// Production Neon: ATS_ENV=production → server/.env
const useIgs = explicitIgs && igsExists;
const useLocal = !useIgs && explicitLocal && localExists;
const useStaging = !useIgs &&
    !useLocal &&
    (process.env.ATS_ENV === 'staging' ||
        (!explicitProduction && !explicitIgs && !explicitLocal && !isDeployed && stagingExists));
const envPath = useIgs
    ? igsPath
    : useLocal
        ? localPath
        : useStaging && stagingExists
            ? stagingPath
            : defaultPath;
const envFileName = path.basename(envPath);
// Override shell DATABASE_URL so local dev reliably uses the selected env file.
const shouldOverrideEnv = !isDeployed;
const parsedEnv = dotenv.config({ path: envPath, override: shouldOverrideEnv }).parsed ?? {};
/**
 * Local staging/IGS/local files often omit email secrets. A stale shell RESEND_API_KEY
 * then makes health report "configured" while sends fail with "API key is invalid".
 * Clear email vars that are not defined in the active env file.
 */
if (shouldOverrideEnv && (useStaging || useIgs || useLocal)) {
    const emailKeys = [
        'RESEND_API_KEY',
        'EMAIL_FROM',
        'M365_TENANT_ID',
        'M365_CLIENT_ID',
        'M365_CLIENT_SECRET',
        'M365_SENDER_EMAIL',
        'M365_SENDER_DISPLAY_NAME',
        'M365_INTEGRATION_API_KEY',
        'M365_CALENDAR_ENABLED',
        'M365_AUTO_TEAMS_MEETING',
        'M365_CALENDAR_ORGANIZER_EMAIL',
        'M365_CALENDAR_TIMEZONE',
    ];
    for (const key of emailKeys) {
        if (!(key in parsedEnv)) {
            delete process.env[key];
        }
    }
}
if (useLocal) {
    process.env.ATS_ENV = 'local';
}
else if (useIgs) {
    process.env.ATS_ENV = 'igs';
}
else if (useStaging && stagingExists && process.env.ATS_ENV !== 'production') {
    process.env.ATS_ENV = 'staging';
}
if (explicitLocal && !localExists) {
    console.warn('ATS_ENV=local but server/.env.local is missing — falling back to another env file.\n' +
        'Copy server/.env.local.example → server/.env.local and set DATABASE_URL to your local Postgres.');
}
try {
    assertStagingDatabaseIsolation(process.env.DATABASE_URL);
}
catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
}
// Local dev must not silently use production Neon (stale shell .env or missing env file).
if (!isDeployed && !explicitProduction) {
    const host = databaseUrlHost(process.env.DATABASE_URL);
    if (isProductionNeonDatabaseUrl(process.env.DATABASE_URL)) {
        console.error(`Refusing to start local API on production Neon (${host}).\n` +
            (localExists
                ? 'Unset DATABASE_URL in your shell, then: npm run dev:local\n'
                : stagingExists
                    ? 'Unset DATABASE_URL in your shell, or run: npm run env:qa\nThen: npm run dev:qa\n'
                    : 'Create server/.env.local (localhost Postgres) or server/.env.staging (Neon QA):\n' +
                        '  Copy server/.env.local.example → server/.env.local\n' +
                        '  Or: $env:STAGING_DATABASE_URL="postgresql://..."; npm run env:qa\n') +
            '\nFor intentional production local testing: npm run dev:prod');
        process.exit(1);
    }
}
if (!isDeployed && useLocal) {
    const host = databaseUrlHost(process.env.DATABASE_URL);
    console.log(`[env] Localhost database → ${host} (from server/${envFileName})`);
}
else if (!isDeployed && useIgs && igsExists) {
    const host = databaseUrlHost(process.env.DATABASE_URL);
    console.log(`[env] Local IGS database → ${host} (from server/${envFileName})`);
}
else if (!isDeployed && useStaging && stagingExists) {
    const host = databaseUrlHost(process.env.DATABASE_URL);
    console.log(`[env] Local QA database → ${host} (from server/${envFileName})`);
}
if (process.env.ATS_ENV === 'local' && !localExists) {
    console.warn('ATS_ENV=local but server/.env.local is missing — falling back to server/.env (likely production).\n' +
        'Copy server/.env.local.example → server/.env.local');
}
else if (process.env.ATS_ENV === 'staging' && !stagingExists) {
    console.warn('ATS_ENV=staging but server/.env.staging is missing — falling back to server/.env (likely production).\n' +
        'Copy the Neon qa branch pooled URL into server/.env.staging, or run:\n' +
        '  $env:STAGING_DATABASE_URL="postgresql://..."; npm run env:qa');
}
else if (!explicitProduction && !explicitLocal && !isDeployed && !stagingExists && !localExists) {
    console.warn('Local dev: no server/.env.local or server/.env.staging — using server/.env (production database).\n' +
        'For localhost Postgres: copy server/.env.local.example → server/.env.local, then npm run dev:local\n' +
        'For Neon QA: $env:STAGING_DATABASE_URL="postgresql://..."; npm run env:qa');
}
export function databaseHostLabel() {
    return databaseUrlHost(process.env.DATABASE_URL);
}
