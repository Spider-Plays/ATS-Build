import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { catalogText } from './catalogRouteFactory.js';
const ok = (v) => catalogText(1, 120).safeParse(v).success;
describe('catalogText', () => {
    it('accepts ordinary catalog names, including punctuation', () => {
        assert.equal(ok('Engineering'), true);
        assert.equal(ok('C++'), true);
        assert.equal(ok('C#'), true);
        assert.equal(ok('R&D'), true);
        assert.equal(ok("O'Reilly Media"), true);
        assert.equal(ok('Node.js / TypeScript'), true);
    });
    it('rejects markup and control characters', () => {
        assert.equal(ok('--><script>alert(1);</script><!--'), false);
        assert.equal(ok('<img src=x onerror=alert(1)>'), false);
        assert.equal(ok('a > b'), false);
        assert.equal(ok('line\nbreak'), false);
        assert.equal(ok('nul\u0000byte'), false);
    });
    it('enforces length limits', () => {
        assert.equal(ok(''), false);
        assert.equal(ok('x'.repeat(121)), false);
    });
});
