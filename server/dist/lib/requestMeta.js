export function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0]?.trim();
    }
    if (Array.isArray(forwarded) && forwarded[0]) {
        return String(forwarded[0]).trim();
    }
    return req.socket.remoteAddress ?? undefined;
}
export function getUserAgent(req) {
    const ua = req.headers['user-agent'];
    if (!ua || typeof ua !== 'string')
        return undefined;
    return ua.slice(0, 500);
}
