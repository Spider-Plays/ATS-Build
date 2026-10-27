import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHttpsUrl, isNonPublicIp } from './outboundUrl.js';
describe('isNonPublicIp', () => {
    it('flags loopback, private, link-local and metadata addresses', () => {
        for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.30.139', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
            assert.equal(isNonPublicIp(ip), true, ip);
        }
    });
    it('allows public addresses', () => {
        for (const ip of ['8.8.8.8', '20.190.160.1', '172.32.0.1', '2606:4700::1111']) {
            assert.equal(isNonPublicIp(ip), false, ip);
        }
    });
});
describe('assertPublicHttpsUrl', () => {
    it('rejects non-https schemes and literal private hosts', async () => {
        await assert.rejects(assertPublicHttpsUrl('http://example.com/cv.pdf'));
        await assert.rejects(assertPublicHttpsUrl('file:///etc/passwd'));
        await assert.rejects(assertPublicHttpsUrl('https://127.0.0.1/cv.pdf'));
        await assert.rejects(assertPublicHttpsUrl('https://[::1]/cv.pdf'));
        await assert.rejects(assertPublicHttpsUrl('https://169.254.169.254/latest/meta-data'));
        await assert.rejects(assertPublicHttpsUrl('https://user:pw@8.8.8.8/cv.pdf'));
    });
    it('accepts a literal public https host', async () => {
        assert.equal((await assertPublicHttpsUrl('https://8.8.8.8/cv.pdf')).hostname, '8.8.8.8');
    });
});
