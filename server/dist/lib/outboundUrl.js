import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
/**
 * Ranges a server-side fetch must never reach. BlockList checks IPv4-mapped IPv6 in any spelling
 * (::ffff:127.0.0.1, or the ::ffff:7f00:1 form URL parsing produces) against the IPv4 rules.
 */
const NON_PUBLIC = new net.BlockList();
for (const [prefix, bits] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) {
    NON_PUBLIC.addSubnet(prefix, bits, 'ipv4');
}
for (const [prefix, bits] of [
    ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
    ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) {
    NON_PUBLIC.addSubnet(prefix, bits, 'ipv6');
}
/** True for loopback, private, link-local, CGNAT, multicast, reserved and IPv4-embedding IPv6 addresses. */
export function isNonPublicIp(address) {
    const ip = address.replace(/^\[|\]$/g, '');
    if (net.isIPv4(ip))
        return NON_PUBLIC.check(ip, 'ipv4');
    if (net.isIPv6(ip))
        return NON_PUBLIC.check(ip, 'ipv6');
    return true;
}
/** Only https URLs whose host resolves exclusively to public addresses may be fetched server-side. */
export async function assertPublicHttpsUrl(raw) {
    const url = new URL(raw);
    if (url.protocol !== 'https:')
        throw new Error('Only https URLs may be fetched');
    if (url.username || url.password)
        throw new Error('URLs with credentials are not allowed');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
    if (addresses.length === 0 || addresses.some(isNonPublicIp)) {
        throw new Error('URL resolves to a non-public address');
    }
    return url;
}
/**
 * The socket's own DNS lookup. Checking here means the address validated is the address connected
 * to, so a second, different DNS answer (rebinding) cannot swap in an internal host after the check.
 */
export const publicOnlyLookup = (hostname, options, callback) => {
    dns.lookup(hostname, { family: options.family, hints: options.hints, all: true }).then((addresses) => {
        if (addresses.length === 0 || addresses.some((a) => isNonPublicIp(a.address))) {
            callback(new Error('URL resolves to a non-public address'), '', 4);
        }
        else if (options.all) {
            callback(null, addresses);
        }
        else {
            callback(null, addresses[0].address, addresses[0].family);
        }
    }, (err) => callback(err, '', 4));
};
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
function getPinned(url, signal) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { lookup: publicOnlyLookup, signal }, (res) => {
            const headers = new Headers();
            for (const [name, value] of Object.entries(res.headers)) {
                if (value !== undefined)
                    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
            const status = res.statusCode ?? 502;
            if (NULL_BODY_STATUSES.has(status)) {
                res.resume();
                resolve(new Response(null, { status, headers }));
                return;
            }
            resolve(new Response(Readable.toWeb(res), { status, headers }));
        });
        req.on('error', reject);
    });
}
/**
 * GET over https that only ever connects to public addresses, re-checked on every redirect hop.
 * Returns a standard Response; redirects are followed here, never by the caller.
 */
export async function fetchPublicHttps(raw, init = {}, maxRedirects = 3) {
    let current = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const url = await assertPublicHttpsUrl(current);
        const res = await getPinned(url, init.signal);
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
            await res.body?.cancel();
            current = new URL(location, url).toString();
            continue;
        }
        return res;
    }
    throw new Error('Too many redirects');
}
