import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';
import { PostgresRateLimitStore } from '../lib/rateLimitStore.js';
/**
 * Coarse per-IP flood guard for unauthenticated auth endpoints. Kept generous because a whole
 * office often signs in from one address; guessing a single account is limited by
 * loginRateLimiter and the per-account lockout instead.
 */
export const authRateLimiter = rateLimit({
    store: new PostgresRateLimitStore('auth:'),
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 200 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' },
});
/** Password sign-in, keyed by address and account so one user's typos never block colleagues. */
export const loginRateLimiter = rateLimit({
    store: new PostgresRateLimitStore('login:'),
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
    store: new PostgresRateLimitStore('refresh:'),
    windowMs: 60 * 1000,
    max: env.isProduction ? 120 : 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});
export const careersRateLimiter = rateLimit({
    store: new PostgresRateLimitStore('careers:'),
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 120 : 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});
export const assistantRateLimiter = rateLimit({
    store: new PostgresRateLimitStore('assistant:'),
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 60 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many assistant requests. Please try again later.' },
});
/** Duplicate-candidate lookups (email / PAN) from external portals, keyed per signed-in user. */
/**
 * Duplicate email/PAN checks from the external vendor and referral portals. Each answer says
 * whether someone is in the candidate database, so the budget covers filling in a few forms
 * (debounced checks) but not working through a list of emails or PANs.
 */
export const lookupRateLimiter = rateLimit({
    store: new PostgresRateLimitStore('lookup:'),
    windowMs: 60 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
    message: { error: 'Too many lookups. Please try again later.' },
});
/** General per-user limit for expensive authenticated endpoints (search, PDF generation). */
export const expensiveRateLimiter = rateLimit({
    store: new PostgresRateLimitStore('expensive:'),
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 300 : 3000,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
    message: { error: 'Too many requests. Please try again later.' },
});
