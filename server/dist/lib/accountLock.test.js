import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_LOCK_MS, isAccountLocked } from './accountLock.js';
describe('isAccountLocked', () => {
    it('is false when never locked', () => {
        assert.equal(isAccountLocked({ lockedAt: null }), false);
    });
    it('is true during the lockout window', () => {
        assert.equal(isAccountLocked({ lockedAt: new Date(Date.now() - 60_000) }), true);
    });
    it('lifts once the window has passed', () => {
        assert.equal(isAccountLocked({ lockedAt: new Date(Date.now() - ACCOUNT_LOCK_MS - 1000) }), false);
    });
});
