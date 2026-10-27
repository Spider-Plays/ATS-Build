import dns from 'node:dns/promises';
import net from 'node:net';
/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses (IPv4 and IPv6). */
export function isNonPublicIp(address) {
    const ip = address.replace(/^\[|\]$/g, '');
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return (a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 198 && (b === 18 || b === 19)));
    }
    if (net.isIPv6(ip)) {
        const lower = ip.toLowerCase();
        const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped)
            return isNonPublicIp(mapped[1]);
        return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
    }
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
/** fetch() that validates the target and every redirect hop against assertPublicHttpsUrl. */
export async function fetchPublicHttps(raw, init = {}, maxRedirects = 3) {
    let current = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const url = await assertPublicHttpsUrl(current);
        const res = await fetch(url, { ...init, redirect: 'manual' });
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
            current = new URL(location, url).toString();
            continue;
        }
        return res;
    }
    throw new Error('Too many redirects');
}
