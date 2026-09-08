import { env } from '../config/env.js';
/** Never log passwords in production — use email delivery instead. */
export function logTemporaryPassword(context, email, password) {
    if (env.isProduction)
        return;
    console.info(`[dev-only] ${context} for ${email}: ${password}`);
}
