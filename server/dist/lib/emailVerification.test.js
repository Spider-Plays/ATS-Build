import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emailVerificationUrl, readEmailVerificationToken } from './emailVerification.js';
function tokenOf(url) {
    return decodeURIComponent(new URL(url).searchParams.get('token'));
}
describe('email verification token', () => {
    const user = { id: 'user_1', email: 'Person@Example.com' };
    it('round-trips and binds to the lower-cased address', () => {
        const parsed = readEmailVerificationToken(tokenOf(emailVerificationUrl(user)));
        assert.equal(parsed?.userId, 'user_1');
        assert.equal(parsed?.email, 'person@example.com');
    });
    it('rejects a tampered payload or signature', () => {
        const [payload, sig] = tokenOf(emailVerificationUrl(user)).split('.');
        const forged = Buffer.from(JSON.stringify({ userId: 'someone_else', email: 'x@y.z', exp: Date.now() + 1e6 })).toString('base64url');
        assert.equal(readEmailVerificationToken(`${forged}.${sig}`), null);
        assert.equal(readEmailVerificationToken(`${payload}.${sig.slice(1)}A`), null);
    });
    it('rejects expired, malformed and empty tokens', () => {
        const expired = Buffer.from(JSON.stringify({ userId: 'u', email: 'a@b.c', exp: Date.now() - 1 })).toString('base64url');
        assert.equal(readEmailVerificationToken(`${expired}.whatever`), null);
        assert.equal(readEmailVerificationToken(''), null);
        assert.equal(readEmailVerificationToken('a.b.c'), null);
    });
});
