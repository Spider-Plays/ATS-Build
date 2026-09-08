import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isNameReorder, isSamePersonName, isShorterFormOf, slugFromName, stitchEmailFromName, } from './ensureStitchUser.js';
describe('slugFromName', () => {
    it('uses firstname.lastinitial format', () => {
        assert.equal(slugFromName('Suma S'), 'suma.s');
        assert.equal(slugFromName('Bharath C'), 'bharath.c');
        assert.equal(slugFromName('Jagdish K'), 'jagdish.k');
        assert.equal(slugFromName('Harsha Kumar C'), 'harsha.k');
        assert.equal(slugFromName('K JAGDISH'), 'jagdish.k');
        assert.equal(slugFromName('Suma'), 'suma');
    });
    it('builds stitch emails', () => {
        assert.equal(stitchEmailFromName('Suma S'), 'suma.s@stitch-ats.in');
        assert.equal(stitchEmailFromName('Priya Sharma'), 'priya.s@stitch-ats.in');
    });
});
describe('isSamePersonName', () => {
    it('matches shorter forms and reordered names', () => {
        assert.equal(isShorterFormOf('Suma', 'Suma S'), true);
        assert.equal(isNameReorder('K JAGDISH', 'Jagdish K'), true);
        assert.equal(isSamePersonName('Maharudra.N', 'Maharudra N'), true);
        assert.equal(isSamePersonName('Bharath C', 'Bharath S'), false);
    });
});
