import { env } from '../../config/env.js';
import { databaseHostLabel } from '../../config/loadEnv.js';
import { assertStagingDatabaseIsolation, databaseUrlHost, isProductionNeonDatabaseUrl, } from '../../config/databaseEnv.js';
export function argvHasForce(argv) {
    return argv.includes('--force');
}
export function looksProductionDatabase() {
    const host = process.env.DATABASE_URL ?? '';
    return (host.includes('weathered-math') ||
        process.env.RENDER === 'true' ||
        process.env.NODE_ENV === 'production' ||
        isProductionNeonDatabaseUrl(host));
}
/** Soft guard: refuse production unless `--force`. */
export function refuseProductionUnlessForced(argv, actionLabel) {
    const force = argvHasForce(argv);
    if (env.isProduction && !force) {
        console.error(`Refusing ${actionLabel} in production. Pass --force to override.`);
        process.exit(1);
    }
    if (looksProductionDatabase() && !force) {
        console.error(`Refusing ${actionLabel} on a production-looking DB (${databaseHostLabel() ?? 'unknown'}).\n` +
            'Use ATS_ENV=staging / server/.env.staging, or pass --force if intentional.');
        process.exit(1);
    }
}
/** Hard staging isolation + refuse production Neon (used by full clear). */
export function assertSafeClearTarget() {
    const url = process.env.DATABASE_URL;
    assertStagingDatabaseIsolation(url);
    if (isProductionNeonDatabaseUrl(url)) {
        throw new Error(`Refusing to clear production Neon (${databaseUrlHost(url)}). Use ATS_ENV=staging / local DATABASE_URL.`);
    }
}
export function requireEnvConfirm(envKey, hint) {
    const value = process.env[envKey]?.trim().toLowerCase();
    if (value === 'yes')
        return;
    console.error(`Refusing to run without confirmation.\n` +
        `Set ${envKey}=yes to proceed.\n` +
        (hint ? `${hint}\n` : '') +
        `Target DB: ${databaseHostLabel() ?? '(unknown)'}`);
    process.exit(1);
}
export function targetDbLabel() {
    return databaseHostLabel() ?? '(unknown)';
}
