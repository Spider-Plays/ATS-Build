import { randomBytes } from 'crypto';
/** URL-safe temporary password for invites */
export function generateTempPassword() {
    return randomBytes(12).toString('base64url');
}
