import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: env.isProduction ? 20 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' },
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
