import { env } from '../../config/env.js';
import { databaseHostLabel } from '../../config/loadEnv.js';
export function argvHasForce(argv) {
    return argv.includes('--force');
}
export function looksProductionDatabase() {
    const host = process.env.DATABASE_URL ?? '';
    return (process.env.NODE_ENV === 'production' || host.includes('localhost') === false);
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
            'Use the local PostgreSQL DATABASE_URL, or pass --force if intentional.');
        process.exit(1);
    }
}
/** Refuse destructive operations against a non-local database. */
export function assertSafeClearTarget() {
    const url = process.env.DATABASE_URL;
    if (!url?.includes('localhost') && !url?.includes('127.0.0.1')) {
        throw new Error(`Refusing to clear non-local database (${databaseHostLabel() ?? 'unknown'}).`);
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
