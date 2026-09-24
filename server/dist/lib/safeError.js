import { env } from '../config/env.js';
export function clientErrorMessage(err, devFallback = 'Internal server error') {
    if (env.isProduction)
        return 'Internal server error';
    if (err instanceof Error && err.message)
        return err.message;
    return devFallback;
}
export function emailDeliveryErrorMessage(detail) {
    if (env.isProduction)
        return 'Email delivery failed';
    const cleaned = detail?.trim();
    if (!cleaned)
        return 'Email delivery failed';
    if (/api key is invalid/i.test(cleaned)) {
        return ('Email delivery failed: RESEND_API_KEY is invalid. ' +
            'Update RESEND_API_KEY or set M365_* in the root .env, then restart the API.');
    }
    return `Email delivery failed: ${cleaned}`;
}
export const EMAIL_NOT_CONFIGURED_WARNING = 'Email is not configured. Set Microsoft 365 (M365_*) or RESEND_API_KEY in the root .env, then restart the API.';
export const EMAIL_NOT_CONFIGURED_DEV_HINT = 'Temporary password was logged to the API server console (dev only).';
export const EMAIL_TEMP_PASSWORD_DEV_HINT = 'Temporary password was logged to the API server console (dev only).';
