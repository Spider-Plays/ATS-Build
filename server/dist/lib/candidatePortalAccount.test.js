import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhoneForPortalPassword } from './candidatePortalAccount.js';
describe('normalizePhoneForPortalPassword', () => {
    it('returns digits-only phone when long enough', () => {
        assert.equal(normalizePhoneForPortalPassword('98765 43210'), '9876543210');
        assert.equal(normalizePhoneForPortalPassword('+91-9876543210'), '919876543210');
    });
    it('rejects missing or too-short values', () => {
        assert.equal(normalizePhoneForPortalPassword(null), null);
        assert.equal(normalizePhoneForPortalPassword(''), null);
        assert.equal(normalizePhoneForPortalPassword('1234567'), null);
    });
});
