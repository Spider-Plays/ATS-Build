/** Auth responses must never be cached by browsers or intermediaries. */
export function applyNoStoreAuth(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}
export function sendAuthUnauthorized(res, message = 'Unauthorized') {
    applyNoStoreAuth(res);
    return res.status(401).json({ error: message, code: 'UNAUTHORIZED' });
}
/**
 * CSP for server-rendered HTML documents (offer letters, reports, RSVP pages):
 * inline styles and embedded data: images only, no scripts or outbound requests.
 */
export function applyDocumentCsp(res, options = {}) {
    res.setHeader('Content-Security-Policy', [
        "default-src 'none'",
        "img-src data:",
        "style-src 'unsafe-inline'",
        options.allowForm ? "form-action 'self'" : "form-action 'none'",
        "frame-ancestors 'self'",
    ].join('; '));
}
