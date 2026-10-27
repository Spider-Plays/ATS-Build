import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { excludeLanIpOrigins, isPrivateOrLocalOrigin, parseClientOrigins, resolvePublicAppUrl, selectEmailLinkOrigin, } from './appUrl.js';
describe('resolvePublicAppUrl', () => {
    it('uses APP_URL when it is the public site', () => {
        assert.equal(resolvePublicAppUrl({
            appUrl: 'https://ats.igsglobal.co',
            clientOrigins: parseClientOrigins('https://ats.igsglobal.co,http://192.168.10.64:3000,http://192.168.10.64:5173'),
            isProduction: true,
        }), 'https://ats.igsglobal.co');
    });
    it('ignores a LAN APP_URL and picks the public CLIENT_ORIGIN', () => {
        assert.equal(resolvePublicAppUrl({
            appUrl: 'http://192.168.10.64:3000',
            clientOrigins: parseClientOrigins('https://ats.igsglobal.co,http://192.168.10.64:3000'),
            isProduction: true,
        }), 'https://ats.igsglobal.co');
    });
    it('does not treat private IPs as a public origin', () => {
        assert.equal(isPrivateOrLocalOrigin('http://192.168.10.64:3000'), true);
        assert.equal(isPrivateOrLocalOrigin('https://ats.igsglobal.co'), false);
    });
    it('ignores the QA host and uses the production site', () => {
        assert.equal(resolvePublicAppUrl({
            appUrl: 'https://qa.stitch-ats.in',
            clientOrigins: parseClientOrigins('http://localhost:3000'),
            isProduction: true,
            fallback: 'https://ats.igsglobal.co',
        }), 'https://ats.igsglobal.co');
    });
    it('keeps the QA host when this process is staging', () => {
        assert.equal(resolvePublicAppUrl({
            appUrl: 'https://qa.stitch-ats.in',
            clientOrigins: parseClientOrigins('https://qa.stitch-ats.in'),
            isProduction: true,
            isStaging: true,
            fallback: 'https://ats.igsglobal.co',
        }), 'https://qa.stitch-ats.in');
    });
    it('builds reset links on the production site when APP_URL is QA', () => {
        assert.equal(selectEmailLinkOrigin({
            configuredOrigin: 'https://qa.stitch-ats.in',
            requestOrigin: 'https://qa.stitch-ats.in',
            isStaging: false,
        }), 'https://ats.igsglobal.co');
    });
    it('uses the production request origin for the reset link', () => {
        assert.equal(selectEmailLinkOrigin({
            configuredOrigin: 'https://qa.stitch-ats.in',
            allowedOrigins: ['https://ats.igsglobal.co'],
            requestOrigin: 'https://ats.igsglobal.co',
            isStaging: false,
        }), 'https://ats.igsglobal.co');
    });
    it('strips LAN IPs from CLIENT_ORIGIN and keeps the public site', () => {
        assert.deepEqual(excludeLanIpOrigins(parseClientOrigins('https://ats.igsglobal.co,http://192.168.10.64:3000,http://localhost:3000')), ['https://ats.igsglobal.co', 'http://localhost:3000']);
    });
});
