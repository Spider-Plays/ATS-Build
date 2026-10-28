import crypto from 'crypto';
import bcrypt from 'bcryptjs';
/**
 * Password hash for accounts created by the legacy import. The password is random and never
 * shown, so nobody can sign in with it: imported staff sign in with Microsoft SSO or set a
 * password from an admin reset link. A shared default password here would let anyone who
 * guesses an imported email (first.last@...) sign in and enrol their own MFA device.
 */
export async function unusablePasswordHash() {
    return bcrypt.hash(crypto.randomBytes(32).toString('base64url'), 10);
}
