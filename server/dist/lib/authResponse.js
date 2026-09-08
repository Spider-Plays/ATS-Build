/** Auth responses must never be cached by browsers or intermediaries. */
export function applyNoStoreAuth(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}
/**
 * Tell the browser to wipe localStorage/sessionStorage for this origin.
 * Used when a session is invalid so users are not stuck after API deploys.
 */
export function applyStaleSessionReset(res) {
    applyNoStoreAuth(res);
    res.setHeader('Clear-Site-Data', '"storage"');
}
export function sendAuthUnauthorized(res, message = 'Unauthorized') {
    applyNoStoreAuth(res);
    return res.status(401).json({ error: message, code: 'UNAUTHORIZED' });
}
