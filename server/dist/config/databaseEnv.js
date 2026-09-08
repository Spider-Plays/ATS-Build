/** Neon host fragment for the production branch (main). Do not use on QA/staging. */
export const PRODUCTION_NEON_HOST_MARKERS = ['weathered-math'];
export function databaseUrlHost(url) {
    const value = url?.trim();
    if (!value)
        return null;
    try {
        return new URL(value).hostname;
    }
    catch {
        return null;
    }
}
export function isProductionNeonDatabaseUrl(url) {
    const host = databaseUrlHost(url) ?? '';
    return PRODUCTION_NEON_HOST_MARKERS.some((marker) => host.includes(marker));
}
export function isStagingRuntime() {
    if (process.env.ATS_ENV === 'local')
        return false;
    if (process.env.ATS_ENV === 'staging')
        return true;
    if (process.env.NODE_ENV !== 'production' && process.env.ATS_ENV !== 'production') {
        const host = databaseUrlHost(process.env.DATABASE_URL);
        if (host && !isProductionNeonDatabaseUrl(process.env.DATABASE_URL))
            return true;
    }
    const signals = [process.env.APP_URL ?? '', process.env.CLIENT_ORIGIN ?? ''];
    return signals.some((value) => value.includes('qa.stitch-ats.in'));
}
export function assertStagingDatabaseIsolation(url) {
    if (!isStagingRuntime())
        return;
    if (process.env.ALLOW_PRODUCTION_DATABASE_ON_STAGING === '1')
        return;
    if (!isProductionNeonDatabaseUrl(url))
        return;
    const host = databaseUrlHost(url);
    throw new Error(`QA staging is connected to the production Neon database (${host}).\n` +
        'Update Render stitch-ats-api-staging (ats-0dtj) DATABASE_URL to the Neon qa branch pooled URL,\n' +
        'or run locally: $env:STAGING_DATABASE_URL="postgresql://..."; npm run env:qa');
}
