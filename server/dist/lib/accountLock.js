/** A lockout from repeated wrong passwords or codes lasts this long, then lifts on its own. */
export const ACCOUNT_LOCK_MS = 30 * 60 * 1000;
/** Lock message with the minutes left before the lockout lifts. */
export function accountLockedMessage(user) {
    const leftMs = user.lockedAt ? ACCOUNT_LOCK_MS - (Date.now() - user.lockedAt.getTime()) : ACCOUNT_LOCK_MS;
    const minutes = Math.max(1, Math.ceil(leftMs / 60000));
    return `Your account is locked. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try logging in again, or contact your Super Admin.`;
}
/** True while the lockout is still running. An expired lockout no longer blocks sign-in. */
export function isAccountLocked(user) {
    return Boolean(user.lockedAt) && Date.now() - user.lockedAt.getTime() < ACCOUNT_LOCK_MS;
}
