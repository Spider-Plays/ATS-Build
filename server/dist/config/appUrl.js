/** Public site URL used in emails and login links — never a LAN IP or the QA host. */
/** Live production app. `ats.igsglobal.in` does not resolve; this host does. */
export const PRODUCTION_APP_URL = 'https://ats.igsglobal.co';
export function parseClientOrigins(raw) {
    return raw
        .split(',')
        .map((value) => value.trim().replace(/\/$/, ''))
        .filter(Boolean);
}
export function isLanIpHost(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host))
        return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host))
        return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host))
        return true;
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host))
        return true;
    return false;
}
export function isPrivateOrLocalHost(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0')
        return true;
    return isLanIpHost(host);
}
/** Drop office/LAN IPs from CORS so they cannot leak into email links. */
export function excludeLanIpOrigins(origins) {
    return origins.filter((origin) => {
        try {
            return !isLanIpHost(new URL(origin).hostname);
        }
        catch {
            return false;
        }
    });
}
export function isPrivateOrLocalOrigin(url) {
    try {
        return isPrivateOrLocalHost(new URL(url).hostname);
    }
    catch {
        return true;
    }
}
function isPreviewHost(url) {
    try {
        const host = new URL(url).hostname;
        return host.endsWith('.pages.dev') || host.endsWith('.workers.dev');
    }
    catch {
        return false;
    }
}
function isPublicHttps(url) {
    if (!url || url.includes(','))
        return false;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && !isPrivateOrLocalHost(parsed.hostname);
    }
    catch {
        return false;
    }
}
/** QA / staging sites must not be used for production password-reset links. */
export function isStagingAppHost(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === 'qa.stitch-ats.in' || host.startsWith('qa.');
    }
    catch {
        return false;
    }
}
function normalizeOrigin(url) {
    return url?.trim().replace(/\/$/, '') || '';
}
/**
 * Prefer APP_URL when it is a public hostname. Skip LAN IPs so reset/invite
 * emails open the live site (https://ats.igsglobal.co) instead of 192.168.x.
 * Skip QA hosts (qa.stitch-ats.in) unless this process is staging.
 */
export function resolvePublicAppUrl(params) {
    const fallback = params.fallback ?? 'http://localhost:3000';
    const appUrl = params.appUrl?.trim().replace(/\/$/, '') || '';
    const candidates = [appUrl, ...params.clientOrigins].filter(Boolean);
    const usable = params.isStaging ? candidates : candidates.filter((url) => !isStagingAppHost(url));
    const publicHttps = usable.filter(isPublicHttps);
    if (publicHttps.length > 0) {
        return publicHttps.find((url) => !isPreviewHost(url)) ?? publicHttps[0];
    }
    const publicAny = usable.find((url) => !url.includes(',') && !isPrivateOrLocalOrigin(url));
    if (publicAny)
        return publicAny;
    if (params.isProduction) {
        if (!params.isStaging && isStagingAppHost(fallback))
            return PRODUCTION_APP_URL;
        return fallback;
    }
    return usable[0] || candidates[0] || fallback;
}
/**
 * Base URL for a password-reset email. A forged Origin is ignored.
 * Production never links to qa.stitch-ats.in.
 */
export function selectEmailLinkOrigin(params) {
    const production = normalizeOrigin(params.productionOrigin) || PRODUCTION_APP_URL;
    const configured = normalizeOrigin(params.configuredOrigin);
    const request = normalizeOrigin(params.requestOrigin);
    const allowed = new Set([configured, production, ...(params.allowedOrigins ?? []).map((origin) => normalizeOrigin(origin))].filter(Boolean));
    if (request && isPublicHttps(request) && allowed.has(request)) {
        if (params.isStaging || !isStagingAppHost(request))
            return request;
    }
    if (!params.isStaging && (!configured || isStagingAppHost(configured)))
        return production;
    return configured || production;
}
