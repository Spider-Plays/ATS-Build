import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';
/**
 * Coarse per-IP flood guard for unauthenticated auth endpoints. Kept generous because a whole
 * office often signs in from one address; guessing a single account is limited by
 * loginRateLimiter and the per-account lockout instead.
 */
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 200 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' },
});
/** Password sign-in, keyed by address and account so one user's typos never block colleagues. */
export const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return `${ipKeyGenerator(req.ip ?? '')}|${email}`;
    },
    message: { error: 'Too many sign-in attempts for this account. Try again in 15 minutes or reset your password.' },
});
/** Token refresh runs on every page load; it is not a credential guess, so it has its own budget. */
export const refreshRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: env.isProduction ? 120 : 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});
export const careersRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 120 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});
export const assistantRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 60 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many assistant requests. Please try again later.' },
});
/** Duplicate-candidate lookups (email / PAN) from external portals, keyed per signed-in user. */
export const lookupRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
    message: { error: 'Too many lookups. Please try again later.' },
});
/** General per-user limit for expensive authenticated endpoints (search, PDF generation). */
export const expensiveRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 300 : 3000,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
    message: { error: 'Too many requests. Please try again later.' },
});
