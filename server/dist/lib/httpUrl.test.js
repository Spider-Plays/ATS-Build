import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { httpUrlOptional } from './httpUrl.js';
const ok = (v) => httpUrlOptional.safeParse(v).success;
describe('httpUrlOptional', () => {
    it('accepts empty, http(s) and scheme-less links', () => {
        assert.equal(ok(undefined), true);
        assert.equal(ok(''), true);
        assert.equal(ok('https://linkedin.com/in/someone'), true);
        assert.equal(ok('http://example.com'), true);
        assert.equal(ok('linkedin.com/in/someone'), true);
    });
    it('rejects script-capable schemes, including whitespace tricks', () => {
        assert.equal(ok('javascript:alert(1)'), false);
        assert.equal(ok('JaVaScRiPt:alert(1)'), false);
        assert.equal(ok('java\tscript:alert(1)'), false);
        assert.equal(ok(' javascript:alert(1)'), false);
        assert.equal(ok('data:text/html,<script>1</script>'), false);
    });
});
