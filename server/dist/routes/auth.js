import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { mapUser } from '../utils/mappers.js';
import { getAllowedPagesForRole } from '../lib/pageAccess.js';
import { requireAuth, requireActiveUser } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { recordUserLogin } from '../lib/recordLogin.js';
import { issuePasswordResetLink } from '../lib/passwordReset.js';
import { applyNoStoreAuth } from '../lib/authResponse.js';
import { verifyGoogleAccessToken, verifyGoogleIdToken } from '../lib/googleAuth.js';
import { verifyMicrosoftIdToken } from '../lib/microsoftAuth.js';
import { bumpTokenVersionAndRevoke, issueSession, revokeRefreshToken, rotateRefreshToken, signAccessToken, } from '../lib/sessionTokens.js';
const router = Router();
router.use((_req, res, next) => {
    applyNoStoreAuth(res);
    next();
});
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});
const registerCandidateSchema = z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});
const googleSignInSchema = z
    .object({
    /** GIS ID token (One Tap / official button). */
    credential: z.string().min(1).optional(),
    /** GIS OAuth access token (custom portal button). */
    accessToken: z.string().min(1).optional(),
})
    .refine((v) => Boolean(v.credential || v.accessToken), {
    message: 'Google credential or accessToken is required',
});
const microsoftSignInSchema = z.object({
    idToken: z.string().min(1),
});
async function issueAppSession(userId, req) {
    await recordUserLogin(userId, req);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user)
        throw new Error('User not found');
    const { userId: _userId, ...tokens } = await issueSession({
        id: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.tokenVersion ?? 0,
    }, req);
    const allowedPages = await getAllowedPagesForRole(user.role);
    return { ...tokens, user: mapUser(user), allowedPages };
}
router.post('/register-candidate', authRateLimiter, async (req, res, next) => {
    try {
        const parsed = registerCandidateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.errors[0]?.message || 'Invalid registration data',
            });
        }
        const email = parsed.data.email.toLowerCase();
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }
        const name = `${parsed.data.firstName.trim()} ${parsed.data.lastName.trim()}`.trim();
        const passwordHash = await bcrypt.hash(parsed.data.password, 10);
        const user = await prisma.user.create({
            data: {
                email,
                name,
                passwordHash,
                role: 'CANDIDATE',
                status: 'ACTIVE',
                department: 'Candidate',
            },
        });
        const session = await issueAppSession(user.id, req);
        res.status(201).json(session);
    }
    catch (err) {
        next(err);
    }
});
router.post('/login', authRateLimiter, async (req, res, next) => {
    try {
        delete req.headers.authorization;
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid credentials' });
        const user = await prisma.user.findUnique({
            where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        if (!user.passwordHash) {
            return res.status(401).json({
                error: 'This account uses Google Sign-In. Use Continue with Google instead.',
            });
        }
        if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        if (user.status === 'DISABLED') {
            return res.status(403).json({ error: 'Account disabled' });
        }
        const session = await issueAppSession(user.id, req);
        res.json(session);
    }
    catch (err) {
        next(err);
    }
});
/**
 * Candidate portal Google Sign-In.
 * Verifies a GIS ID token, finds/creates a CANDIDATE user, issues the same JWT as password login.
 */
router.post('/google', authRateLimiter, async (req, res, next) => {
    try {
        delete req.headers.authorization;
        if (!env.googleClientId) {
            return res.status(503).json({
                error: 'Google Sign-In is not configured. Set GOOGLE_CLIENT_ID on the server.',
            });
        }
        const parsed = googleSignInSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid Google sign-in request' });
        }
        let profile;
        try {
            profile = parsed.data.accessToken
                ? await verifyGoogleAccessToken(parsed.data.accessToken)
                : await verifyGoogleIdToken(parsed.data.credential);
        }
        catch {
            return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
        }
        let user = await prisma.user.findFirst({
            where: {
                OR: [{ googleId: profile.googleId }, { email: profile.email }],
            },
        });
        if (user) {
            if (user.role !== 'CANDIDATE') {
                return res.status(403).json({
                    error: 'This sign-in page is for candidates only. Use the team login instead.',
                });
            }
            if (user.status === 'DISABLED') {
                return res.status(403).json({ error: 'Account disabled' });
            }
            // Link Google identity to an existing local candidate account (verified email).
            const needsLink = !user.googleId || user.googleId !== profile.googleId;
            if (needsLink || (profile.picture && !user.avatar)) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        googleId: profile.googleId,
                        ...(profile.picture && !user.avatar ? { avatar: profile.picture } : {}),
                        ...(user.authProvider === 'local' && !user.passwordHash
                            ? { authProvider: 'google' }
                            : {}),
                    },
                });
            }
        }
        else {
            user = await prisma.user.create({
                data: {
                    email: profile.email,
                    name: profile.name,
                    passwordHash: null,
                    role: 'CANDIDATE',
                    status: 'ACTIVE',
                    department: 'Candidate',
                    authProvider: 'google',
                    googleId: profile.googleId,
                    avatar: profile.picture ?? null,
                    mustChangePassword: false,
                },
            });
        }
        const session = await issueAppSession(user.id, req);
        res.json(session);
    }
    catch (err) {
        next(err);
    }
});
/** Microsoft Entra SSO for all existing ATS users except candidates. */
router.post('/microsoft', authRateLimiter, async (req, res, next) => {
    try {
        delete req.headers.authorization;
        if (!env.microsoftClientId || !env.microsoftTenantId) {
            return res.status(503).json({
                error: 'Microsoft SSO is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_TENANT_ID on the server.',
            });
        }
        const parsed = microsoftSignInSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid Microsoft sign-in request' });
        let profile;
        try {
            profile = await verifyMicrosoftIdToken(parsed.data.idToken);
        }
        catch {
            return res.status(401).json({ error: 'Microsoft sign-in failed. Please try again.' });
        }
        let user = await prisma.user.findFirst({
            where: {
                OR: [{ microsoftId: profile.microsoftId }, { email: profile.email }],
            },
        });
        if (!user) {
            return res.status(403).json({
                error: 'Your Microsoft account is not linked to an active ATS user. Contact an administrator.',
            });
        }
        if (user.role === 'CANDIDATE') {
            return res.status(403).json({ error: 'Candidates must use the candidate portal Google sign-in.' });
        }
        if (user.status === 'DISABLED')
            return res.status(403).json({ error: 'Account disabled' });
        if (user.microsoftId !== profile.microsoftId) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: { microsoftId: profile.microsoftId, authProvider: user.passwordHash ? user.authProvider : 'microsoft' },
            });
        }
        const session = await issueAppSession(user.id, req);
        res.json(session);
    }
    catch (err) {
        next(err);
    }
});
router.get('/me', requireAuth, requireActiveUser, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const allowedPages = await getAllowedPagesForRole(user.role);
    const token = req.auth.role !== user.role
        ? signAccessToken({
            userId: user.id,
            email: user.email,
            role: user.role,
            tokenVersion: user.tokenVersion ?? 0,
        })
        : undefined;
    res.json({ ...mapUser(user), allowedPages, ...(token ? { token } : {}) });
});
const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});
router.post('/change-password', requireAuth, requireActiveUser, async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid input' });
    }
    const { currentPassword, newPassword } = parsed.data;
    if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'New password must be different from your current password' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    if (!user.passwordHash) {
        return res.status(400).json({
            error: 'This account uses Google Sign-In and has no password. Sign in with Google instead.',
        });
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid)
        return res.status(401).json({ error: 'Current password is incorrect' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
        where: { id: user.id },
        data: {
            passwordHash,
            mustChangePassword: false,
            passwordResetToken: null,
            passwordResetExpires: null,
        },
    });
    const tokenVersion = await bumpTokenVersionAndRevoke(user.id);
    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    if (!updated)
        return res.status(404).json({ error: 'User not found' });
    const { userId: _uid, ...tokens } = await issueSession({
        id: updated.id,
        email: updated.email,
        role: updated.role,
        tokenVersion,
    }, req);
    const allowedPages = await getAllowedPagesForRole(updated.role);
    res.json({ ...tokens, user: mapUser(updated), allowedPages });
});
router.post('/forgot-password', authRateLimiter, async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });
    // Google-only accounts have no password — skip email so we don't set one unexpectedly.
    if (user && user.status === 'ACTIVE' && user.passwordHash) {
        await issuePasswordResetLink(user);
    }
    res.json({ ok: true, message: 'If that email exists, a reset link was sent.' });
});
router.post('/reset-password', authRateLimiter, async (req, res) => {
    const { token, newPassword } = z
        .object({
        token: z.string().min(1),
        newPassword: z.string().min(8),
    })
        .parse(req.body);
    const user = await prisma.user.findFirst({
        where: {
            passwordResetToken: token,
            passwordResetExpires: { gt: new Date() },
        },
    });
    if (!user)
        return res.status(400).json({ error: 'Invalid or expired reset link' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
        where: { id: user.id },
        data: {
            passwordHash,
            mustChangePassword: false,
            passwordResetToken: null,
            passwordResetExpires: null,
        },
    });
    await bumpTokenVersionAndRevoke(user.id);
    res.json({ ok: true, message: 'Password updated. You can sign in now.' });
});
const refreshSchema = z.object({
    refreshToken: z.string().min(1),
});
router.post('/refresh', authRateLimiter, async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Refresh token is required', code: 'INVALID' });
    }
    const result = await rotateRefreshToken(parsed.data.refreshToken, req);
    if ('error' in result) {
        const code = result.error === 'reuse' ? 'SESSION_REVOKED' : 'INVALID_REFRESH';
        return res.status(401).json({ error: 'Refresh token is not valid', code });
    }
    const { userId, ...tokens } = result;
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });
    if (!user)
        return res.status(401).json({ error: 'Refresh token is not valid', code: 'INVALID_REFRESH' });
    const allowedPages = await getAllowedPagesForRole(user.role);
    res.json({ ...tokens, user: mapUser(user), allowedPages });
});
router.post('/logout', async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (parsed.success) {
        await revokeRefreshToken(parsed.data.refreshToken);
    }
    res.json({ ok: true });
});
export default router;
