import express, { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { applyDocumentCsp } from '../lib/authResponse.js';
import { markEmailVerified, readEmailVerificationToken } from '../lib/emailVerification.js';
import { env } from '../config/env.js';
const router = Router();
router.use((_req, res, next) => {
    applyDocumentCsp(res, { allowForm: true });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});
function page(title, message) {
    return `<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;padding:48px;color:#1a2b3c"><h1>${title}</h1><p>${message}</p></body></html>`;
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function tokenFrom(req) {
    const fromBody = typeof req.body?.token === 'string' ? req.body.token : '';
    const fromQuery = typeof req.query.token === 'string' ? req.query.token : '';
    return fromBody || fromQuery;
}
const INVALID_LINK = 'This confirmation link is not valid or has expired. Sign in to request a new one.';
// GET only asks for confirmation, so mail link scanners that open the link verify nothing.
router.get('/', (req, res) => {
    const token = tokenFrom(req);
    if (!readEmailVerificationToken(token))
        return res.status(400).send(page('Link not valid', INVALID_LINK));
    res.send(page('Confirm your email', `<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"/>` +
        `<button type="submit" style="font:inherit;padding:10px 20px;border:0;border-radius:8px;background:#1a2b3c;color:#fff;cursor:pointer">Confirm email</button></form>`));
});
router.post('/', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    const parsed = readEmailVerificationToken(tokenFrom(req));
    if (!parsed)
        return res.status(400).send(page('Link not valid', INVALID_LINK));
    const user = await prisma.user.findUnique({ where: { id: parsed.userId } });
    // The token is bound to the address it was sent to; an address change invalidates it.
    if (!user || user.role !== 'CANDIDATE' || user.email.toLowerCase() !== parsed.email) {
        return res.status(400).send(page('Link not valid', INVALID_LINK));
    }
    await markEmailVerified(user.id);
    const signInUrl = `${env.clientOrigin.replace(/\/$/, '')}/login`;
    res.send(page('Email confirmed', `Your email is confirmed. <a href="${escapeHtml(signInUrl)}">Sign in</a> to continue.`));
});
export default router;
