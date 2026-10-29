import { BCRYPT_ROUNDS, newPasswordSchema, personalInfoPasswordError } from '../lib/passwordPolicy.js';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { mapUser } from '../utils/mappers.js';
import { getAllowedPagesForRole } from '../lib/pageAccess.js';
import { requireAuth, requireActiveUser } from '../middleware/auth.js';
import { authRateLimiter, loginRateLimiter, refreshRateLimiter } from '../middleware/rateLimit.js';
import { closeLoginSession, reopenRecentTabClose } from '../lib/recordLogin.js';
import { issueAppSession } from '../lib/appSession.js';
import { CSRF_HEADER, clearRefreshCookie, isCrossSiteRequest, readRefreshCookie, withRefreshCookie } from '../lib/refreshCookie.js';
import { isTrustedDevice, mfaRequiredForRole, revokeTrustedDevices, signMfaToken } from '../lib/mfa.js';
import { readMfaDeviceCookie, setMfaDeviceCookie } from '../lib/mfaDeviceCookie.js';
import mfaRoutes from './mfa.js';
import emailVerificationRoutes from './emailVerification.js';
import { sendEmailVerification } from '../lib/emailVerification.js';
import { accountLockedMessage, isAccountLocked } from '../lib/accountLock.js';
import { hashResetToken, issuePasswordResetLink } from '../lib/passwordReset.js';
import { applyNoStoreAuth } from '../lib/authResponse.js';
import { clearCounter, extendCounter, hitCounter, readCounter } from '../lib/rateLimitStore.js';
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
    /** "Remember this device" token from a previous MFA sign-in on this browser. */
    deviceToken: z.string().min(1).max(200).optional(),
});
const registerCandidateSchema = z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email(),
    password: newPasswordSchema,
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
/** Roles an Entra sign-in may never claim by email alone (see the Microsoft route). */
const SSO_EMAIL_LINK_BLOCKED_ROLES = ['ADMIN', 'DEVELOPER'];
/** First-time Microsoft linking by email, limited to MICROSOFT_ALLOWED_EMAIL_DOMAINS when set. */
function canLinkMicrosoftByEmail(email) {
    const domains = env.microsoftAllowedEmailDomains;
    if (domains.length === 0)
        return true;
    const domain = email.split('@')[1] ?? '';
    return domains.includes(domain);
}
router.get('/sso', (_req, res) => {
    const clientId = env.microsoftClientId;
    const tenantId = env.microsoftTenantId;
    res.json({
        microsoft: clientId && tenantId
            ? { clientId, tenantId }
            : null,
    });
});
router.post('/register-candidate', authRateLimiter, async (req, res, next) => {
    try {
        const parsed = registerCandidateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.issues[0]?.message || 'Invalid registration data',
            });
        }
        const email = parsed.data.email.toLowerCase();
        const personalError = personalInfoPasswordError(parsed.data.password, {
            email,
            name: `${parsed.data.firstName} ${parsed.data.lastName}`,
        });
        if (personalError)
            return res.status(400).json({ error: personalError });
        // Same answer whether or not the address is already registered, so this cannot be used to
        // discover who has an account. The session is only issued after the email link is confirmed.
        const accepted = {
            verificationRequired: true,
            message: 'Check your email for a confirmation link to finish creating your account. If you already have an account, sign in or use "Forgot password".',
        };
        // Answer before any lookup, hashing or mail: doing that work only for new addresses would
        // reveal, by response time, which addresses already have an account.
        res.status(202).json(accepted);
        const name = `${parsed.data.firstName.trim()} ${parsed.data.lastName.trim()}`.trim();
        registerCandidateInBackground(email, name, parsed.data.password).catch((err) => console.error('[auth] candidate registration failed:', err));
    }
    catch (err) {
        next(err);
    }
});
async function registerCandidateInBackground(email, name, password) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
        return;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    let user;
    try {
        user = await prisma.user.create({
            data: {
                email,
                name,
                passwordHash,
                role: 'CANDIDATE',
                status: 'ACTIVE',
                department: 'Candidate',
            },
        });
    }
    catch (err) {
        // Lost a race with a parallel registration for the same address.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
            return;
        throw err;
    }
    if (await underVerificationMailCap(email))
        await sendEmailVerification(user);
}
/** Confirmation emails per address per hour, so the endpoints cannot be used to flood an inbox. */
const VERIFICATION_EMAILS_PER_HOUR = 3;
async function underVerificationMailCap(address) {
    const { totalHits } = await hitCounter(`verifymail:${address}`, 60 * 60 * 1000);
    return totalHits <= VERIFICATION_EMAILS_PER_HOUR;
}
/** Sends a fresh confirmation link. Always answers the same way so it reveals nothing about the address. */
router.post('/resend-verification', authRateLimiter, async (req, res, next) => {
    try {
        const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
        // Answer before sending: waiting on the mail provider only for real accounts would reveal them.
        res.json({ ok: true, message: 'If that account needs confirming, a new link was sent.' });
        if (parsed.success) {
            const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
            if (user &&
                user.role === 'CANDIDATE' &&
                !user.emailVerifiedAt &&
                user.passwordHash &&
                user.status === 'ACTIVE' &&
                (await underVerificationMailCap(user.email))) {
                sendEmailVerification(user).catch((err) => console.error('[auth] verification email failed:', err));
            }
        }
    }
    catch (err) {
        next(err);
    }
});
router.use('/verify-email', emailVerificationRoutes);
/** Valid bcrypt hash of a random string, compared against when the account does not exist. */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
/**
 * Account-wide backstop: this many consecutive wrong passwords (from any address) locks the account
 * for a while (see lib/accountLock). Set well above the per-address limit below, so one attacker
 * cannot lock a colleague out just by knowing their email; it still stops guessing spread over
 * many addresses.
 */
const MAX_FAILED_LOGIN_ATTEMPTS = 25;
/** Per address + account: 5 failures within 15 minutes blocks that address for that email for 15 minutes. */
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
// Kept in Postgres (lib/rateLimitStore) so a restart does not wipe the count.
function loginFailureKey(req, email) {
    return `loginfail:${req.ip ?? ''}|${email}`;
}
async function isLoginLocked(key) {
    const entry = await readCounter(key);
    return Boolean(entry && entry.totalHits >= LOGIN_FAILURE_LIMIT);
}
async function recordLoginFailure(key) {
    const { totalHits } = await hitCounter(key, LOGIN_LOCK_MS);
    // Reaching the limit holds the block for a full period from the last failure.
    if (totalHits >= LOGIN_FAILURE_LIMIT)
        await extendCounter(key, LOGIN_LOCK_MS);
}
async function clearLoginFailures(key) {
    await clearCounter(key);
}
router.post('/login', authRateLimiter, loginRateLimiter, async (req, res, next) => {
    try {
        delete req.headers.authorization;
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid credentials' });
        const email = parsed.data.email.toLowerCase();
        const failureKey = loginFailureKey(req, email);
        if (await isLoginLocked(failureKey)) {
            return res.status(429).json({
                error: 'Too many failed sign-in attempts. Try again in 15 minutes or reset your password.',
            });
        }
        const user = await prisma.user.findUnique({ where: { email } });
        // Always run one bcrypt comparison so response time does not reveal whether the account exists.
        const passwordOk = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
        const credentialsOk = Boolean(user?.passwordHash) && passwordOk;
        // While locked, the lock is only revealed to someone who already knows the correct password.
        // Before that, a wrong password on an existing account reports the attempts left.
        if (user && isAccountLocked(user)) {
            if (!credentialsOk)
                return res.status(401).json({ error: 'Invalid email or password' });
            return res.status(423).json({ error: accountLockedMessage(user), code: 'ACCOUNT_LOCKED' });
        }
        if (!user || !credentialsOk) {
            await recordLoginFailure(failureKey);
            if (user?.passwordHash) {
                const attempts = user.failedLoginAttempts + 1;
                const lock = attempts >= MAX_FAILED_LOGIN_ATTEMPTS;
                // Lock new password sign-ins only. Wrong passwords come from whoever typed them, so they must
                // not end the real user's existing sessions; revocation stays with password change and reset.
                await prisma.user.update({
                    where: { id: user.id },
                    data: { failedLoginAttempts: attempts, ...(lock ? { lockedAt: new Date() } : {}) },
                });
            }
            // Same answer whether or not the account exists, so the response cannot be used to find
            // accounts (or count down their lockout). The lock is revealed only with the right password.
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        await clearLoginFailures(failureKey);
        if (user.failedLoginAttempts > 0 || user.lockedAt) {
            await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedAt: null } });
        }
        if (user.status === 'DISABLED') {
            return res.status(403).json({ error: 'Account disabled' });
        }
        if (user.role === 'CANDIDATE' && !user.emailVerifiedAt) {
            return res.status(403).json({
                error: 'Confirm your email first: open the link we sent you, or request a new one.',
                code: 'EMAIL_NOT_VERIFIED',
            });
        }
        // Password is correct. Everyone except candidates must pass a second factor before any
        // session is issued; the challenge token is useless for API calls (typ !== 'access').
        if (mfaRequiredForRole(user.role)) {
            const cookieDevice = readMfaDeviceCookie(req);
            const trustedByCookie = user.mfaEnabled && (await isTrustedDevice(user.id, cookieDevice));
            // Devices remembered before the cookie existed send their token in the body; move it into
            // the HttpOnly cookie. The body token can be dropped once those have expired (15 days).
            const trustedByBody = !trustedByCookie && user.mfaEnabled && (await isTrustedDevice(user.id, parsed.data.deviceToken));
            if (trustedByBody)
                setMfaDeviceCookie(res, parsed.data.deviceToken);
            if (!trustedByCookie && !trustedByBody) {
                return res.json({
                    mfaRequired: true,
                    mfaSetupRequired: !user.mfaEnabled,
                    mfaToken: signMfaToken(user.id, user.mfaEnabled ? 'verify' : 'setup'),
                });
            }
        }
        const session = await issueAppSession(user.id, req, res);
        res.json(session);
    }
    catch (err) {
        next(err);
    }
});
router.use('/mfa', mfaRoutes);
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
            if (isAccountLocked(user)) {
                return res.status(423).json({ error: accountLockedMessage(user), code: 'ACCOUNT_LOCKED' });
            }
            // Link Google identity to an existing local candidate account (verified email).
            // A password set before anyone proved they own this address cannot be trusted: Google has
            // now proved ownership, so drop that password and every session that came with it.
            const unprovenPassword = !user.emailVerifiedAt && Boolean(user.passwordHash);
            const needsLink = !user.googleId || user.googleId !== profile.googleId;
            if (needsLink || unprovenPassword || !user.emailVerifiedAt || (profile.picture && !user.avatar)) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        googleId: profile.googleId,
                        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
                        ...(unprovenPassword ? { passwordHash: null, authProvider: 'google' } : {}),
                        ...(profile.picture && !user.avatar ? { avatar: profile.picture } : {}),
                        ...(!unprovenPassword && user.authProvider === 'local' && !user.passwordHash
                            ? { authProvider: 'google' }
                            : {}),
                    },
                });
                if (unprovenPassword)
                    await bumpTokenVersionAndRevoke(user.id);
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
                    emailVerifiedAt: new Date(),
                    mustChangePassword: false,
                },
            });
        }
        const session = await issueAppSession(user.id, req, res);
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
        // Match on the immutable Entra object ID. Fall back to email only to link an account
        // that has never been linked; an existing link is never overwritten.
        let user = await prisma.user.findFirst({ where: { microsoftId: profile.microsoftId } });
        if (!user && canLinkMicrosoftByEmail(profile.email)) {
            user = await prisma.user.findFirst({
                // The UPN can be renamed inside the tenant, so it never claims the most privileged
                // accounts. Those sign in with password + MFA, and stay usable through an existing link.
                where: { email: profile.email, microsoftId: null, role: { notIn: [...SSO_EMAIL_LINK_BLOCKED_ROLES] } },
            });
        }
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
        if (isAccountLocked(user))
            return res.status(423).json({ error: accountLockedMessage(user), code: 'ACCOUNT_LOCKED' });
        if (user.microsoftId !== profile.microsoftId) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: { microsoftId: profile.microsoftId, authProvider: user.passwordHash ? user.authProvider : 'microsoft' },
            });
        }
        // Microsoft proves the identity but not a second factor this app can see, so staff pass the
        // same MFA challenge as password sign-in (a remembered device skips it, as there).
        if (mfaRequiredForRole(user.role)) {
            const trusted = user.mfaEnabled && (await isTrustedDevice(user.id, readMfaDeviceCookie(req)));
            if (!trusted) {
                return res.json({
                    mfaRequired: true,
                    mfaSetupRequired: !user.mfaEnabled,
                    mfaToken: signMfaToken(user.id, user.mfaEnabled ? 'verify' : 'setup'),
                    email: user.email,
                });
            }
        }
        const session = await issueAppSession(user.id, req, res);
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
            sid: req.auth.sid,
        })
        : undefined;
    res.json({ ...mapUser(user), allowedPages, ...(token ? { token } : {}) });
});
const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: newPasswordSchema,
});
router.post('/change-password', requireAuth, requireActiveUser, async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
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
    const personalError = personalInfoPasswordError(newPassword, user);
    if (personalError)
        return res.status(400).json({ error: personalError });
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
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
    await revokeTrustedDevices(user.id);
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
    res.json({ ...withRefreshCookie(res, tokens), user: mapUser(updated), allowedPages });
});
/** Reset emails per address per hour, so the form cannot be used to flood someone's inbox. */
const RESET_EMAILS_PER_HOUR = 3;
router.post('/forgot-password', authRateLimiter, async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const address = email.toLowerCase();
    const ok = { ok: true, message: 'If that email exists, a reset link was sent.' };
    const { totalHits } = await hitCounter(`resetmail:${address}`, 60 * 60 * 1000);
    if (totalHits > RESET_EMAILS_PER_HOUR)
        return res.json(ok);
    const user = await prisma.user.findUnique({ where: { email: address } });
    // Answer before sending: waiting on the mail provider only for real accounts would reveal,
    // by response time, which addresses have an account.
    res.json(ok);
    // Google-only accounts have no password; skip them so we don't set one unexpectedly.
    if (user && user.status === 'ACTIVE' && user.passwordHash) {
        issuePasswordResetLink(user, req).catch((err) => console.error('[auth] password reset email failed:', err));
    }
});
router.post('/reset-password', authRateLimiter, async (req, res) => {
    const { token, newPassword } = z
        .object({
        token: z.string().min(1),
        newPassword: newPasswordSchema,
    })
        .parse(req.body);
    const user = await prisma.user.findFirst({
        where: {
            passwordResetToken: hashResetToken(token),
            passwordResetExpires: { gt: new Date() },
        },
    });
    if (!user)
        return res.status(400).json({ error: 'Invalid or expired reset link' });
    const personalError = personalInfoPasswordError(newPassword, user);
    if (personalError)
        return res.status(400).json({ error: personalError });
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({
        where: { id: user.id },
        data: {
            passwordHash,
            mustChangePassword: false,
            passwordResetToken: null,
            passwordResetExpires: null,
            // Reaching this point means the caller received the emailed link, so the mailbox is theirs.
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
            // Proving control of the mailbox is also the self-service way out of a sign-in lockout.
            // The MFA failure count stays, so a mailbox holder gets no fresh authenticator-code guesses.
            lockedAt: null,
            failedLoginAttempts: 0,
        },
    });
    await bumpTokenVersionAndRevoke(user.id);
    await revokeTrustedDevices(user.id);
    res.json({ ok: true, message: 'Password updated. You can sign in now.' });
});
/**
 * The refresh token comes from the HttpOnly cookie. The CSRF header is required with it so a
 * cross-site form post cannot use the cookie. A token in the body is still accepted so sessions
 * issued before the cookie existed can move over; it can be dropped once those have expired
 * (REFRESH_TOKEN_TTL_MS after this release).
 */
function presentedRefreshToken(req) {
    const fromCookie = readRefreshCookie(req);
    if (fromCookie)
        return req.get(CSRF_HEADER) && !isCrossSiteRequest(req) ? fromCookie : null;
    const fromBody = req.body?.refreshToken;
    return typeof fromBody === 'string' && fromBody ? fromBody : null;
}
router.post('/refresh', refreshRateLimiter, async (req, res) => {
    const refreshToken = presentedRefreshToken(req);
    if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token is required', code: 'INVALID_REFRESH' });
    }
    const result = await rotateRefreshToken(refreshToken, req);
    if ('error' in result) {
        clearRefreshCookie(res);
        const code = result.error === 'reuse' ? 'SESSION_REVOKED' : 'INVALID_REFRESH';
        return res.status(401).json({ error: 'Refresh token is not valid', code });
    }
    const { userId, ...tokens } = result;
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });
    if (!user) {
        clearRefreshCookie(res);
        return res.status(401).json({ error: 'Refresh token is not valid', code: 'INVALID_REFRESH' });
    }
    const allowedPages = await getAllowedPagesForRole(user.role);
    res.json({ ...withRefreshCookie(res, tokens), user: mapUser(user), allowedPages });
});
router.post('/logout', async (req, res) => {
    const parsed = z
        .object({
        loginHistoryId: z.string().min(1).optional(),
        reason: z.enum(['signed_out', 'idle']).optional(),
    })
        .safeParse(req.body);
    const refreshToken = presentedRefreshToken(req);
    const userId = refreshToken ? await revokeRefreshToken(refreshToken) : null;
    clearRefreshCookie(res);
    if (userId) {
        await closeLoginSession(userId, parsed.success && parsed.data.reason ? parsed.data.reason : 'signed_out', parsed.success ? parsed.data.loginHistoryId : undefined);
    }
    res.json({ ok: true });
});
router.post('/session-end', requireAuth, requireActiveUser, async (req, res) => {
    const parsed = z
        .object({
        loginHistoryId: z.string().min(1),
        reason: z.enum(['tab_closed']),
    })
        .safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Invalid session end' });
    await closeLoginSession(req.auth.userId, parsed.data.reason, parsed.data.loginHistoryId);
    res.json({ ok: true });
});
router.post('/session-resume', requireAuth, requireActiveUser, async (req, res) => {
    const parsed = z.object({ loginHistoryId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Invalid session' });
    await reopenRecentTabClose(req.auth.userId, parsed.data.loginHistoryId);
    res.json({ ok: true });
});
export default router;
