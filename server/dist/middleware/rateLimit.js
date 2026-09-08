import rateLimit from 'express-rate-limit';
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
