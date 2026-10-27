import { env, isLocalDev } from '../config/env.js';
/** Only a local dev machine (ATS_ENV=local) prints temporary passwords; staging/QA use email delivery. */
export function logTemporaryPassword(context, email, password) {
    if (env.isProduction || !isLocalDev)
        return;
    console.info(`[dev-only] ${context} for ${email}: ${password}`);
}
