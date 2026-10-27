import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireActiveUser, requireAuth, requireExactRoles } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { issueAppSession } from '../lib/appSession.js';
import { accountLockedMessage, isAccountLocked } from '../lib/accountLock.js';
import { MFA_MAX_FAILED_ATTEMPTS, buildEnrolment, checkSecondFactor, clearMfaFailures, countRemainingBackupCodes, decryptSecret, encryptSecret, generateTotpSecret, issueTrustedDevice, mfaRequiredForRole, readMfaToken, recordMfaFailure, regenerateBackupCodes, resetUserMfa, verifyTotp, } from '../lib/mfa.js';
const router = Router();
const CHALLENGE_EXPIRED = 'Your sign-in session expired. Please sign in again.';
const challengeSchema = z.object({
    mfaToken: z.string().min(1),
});
const codeSchema = challengeSchema.extend({
    code: z.string().min(6).max(16),
    rememberDevice: z.boolean().optional(),
});
/** Loads the user a challenge token belongs to, or writes the error response and returns null. */
async function loadChallengeUser(res, mfaToken, purpose) {
    const challenge = readMfaToken(mfaToken);
    if (!challenge || challenge.purpose !== purpose) {
        res.status(401).json({ error: CHALLENGE_EXPIRED, code: 'MFA_TOKEN_INVALID' });
        return null;
    }
    const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || user.status === 'DISABLED') {
        res.status(403).json({ error: 'Account disabled' });
        return null;
    }
    if (isAccountLocked(user)) {
        res.status(423).json({ error: accountLockedMessage(user), code: 'ACCOUNT_LOCKED' });
        return null;
    }
    if (!mfaRequiredForRole(user.role)) {
        res.status(403).json({ error: 'Multi-factor authentication is not available for this account' });
        return null;
    }
    return user;
}
/** Responds to a wrong code, counting it toward the lockout. */
async function rejectWrongCode(res, userId) {
    const locked = await recordMfaFailure(userId);
    if (locked) {
        return res.status(423).json({ error: accountLockedMessage({ lockedAt: new Date() }), code: 'ACCOUNT_LOCKED' });
    }
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { mfaFailedAttempts: true },
    });
    const left = MFA_MAX_FAILED_ATTEMPTS - (user?.mfaFailedAttempts ?? 0);
    return res.status(401).json({
        error: `That code is not correct. ${left} attempt${left === 1 ? '' : 's'} left before your account is locked.`,
        code: 'MFA_CODE_INVALID',
    });
}
/** Second step of sign-in for an already enrolled user. */
router.post('/verify', authRateLimiter, async (req, res, next) => {
    try {
        const parsed = codeSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Enter your verification code' });
        const user = await loadChallengeUser(res, parsed.data.mfaToken, 'verify');
        if (!user)
            return;
        if (!user.mfaEnabled) {
            return res.status(409).json({ error: 'Set up multi-factor authentication first', code: 'MFA_NOT_ENROLLED' });
        }
        if (!(await checkSecondFactor(user, parsed.data.code)))
            return rejectWrongCode(res, user.id);
        await clearMfaFailures(user.id);
        const session = await issueAppSession(user.id, req, res);
        const deviceToken = parsed.data.rememberDevice ? await issueTrustedDevice(user.id, req) : undefined;
        res.json({ ...session, ...(deviceToken ? { deviceToken } : {}) });
    }
    catch (err) {
        next(err);
    }
});
/** Enrolment during sign-in: generates a secret and returns the QR code to scan. */
router.post('/setup/start', authRateLimiter, async (req, res, next) => {
    try {
        const parsed = challengeSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Invalid request' });
        const user = await loadChallengeUser(res, parsed.data.mfaToken, 'setup');
        if (!user)
            return;
        if (user.mfaEnabled) {
            return res.status(409).json({ error: 'Multi-factor authentication is already set up', code: 'MFA_ALREADY_ENROLLED' });
        }
        const secret = generateTotpSecret();
        await prisma.user.update({
            where: { id: user.id },
            data: { mfaPendingSecretEnc: encryptSecret(secret) },
        });
        res.json(await buildEnrolment(user.email, secret));
    }
    catch (err) {
        next(err);
    }
});
/** Confirms the first code, switches MFA on, and signs the user in with their backup codes. */
router.post('/setup/confirm', authRateLimiter, async (req, res, next) => {
    try {
        const parsed = codeSchema.safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Enter the 6-digit code from your app' });
        const user = await loadChallengeUser(res, parsed.data.mfaToken, 'setup');
        if (!user)
            return;
        if (user.mfaEnabled) {
            return res.status(409).json({ error: 'Multi-factor authentication is already set up', code: 'MFA_ALREADY_ENROLLED' });
        }
        if (!user.mfaPendingSecretEnc) {
            return res.status(409).json({ error: 'Start setup again to get a new QR code', code: 'MFA_SETUP_NOT_STARTED' });
        }
        const step = verifyTotp(decryptSecret(user.mfaPendingSecretEnc), parsed.data.code);
        if (step === null)
            return rejectWrongCode(res, user.id);
        const enabled = await prisma.user.updateMany({
            where: { id: user.id, mfaEnabled: false },
            data: {
                mfaEnabled: true,
                mfaSecretEnc: user.mfaPendingSecretEnc,
                mfaPendingSecretEnc: null,
                mfaEnrolledAt: new Date(),
                mfaLastStep: step,
                mfaFailedAttempts: 0,
            },
        });
        if (enabled.count !== 1) {
            return res.status(409).json({ error: 'Multi-factor authentication is already set up', code: 'MFA_ALREADY_ENROLLED' });
        }
        const backupCodes = await regenerateBackupCodes(user.id);
        const session = await issueAppSession(user.id, req, res);
        const deviceToken = parsed.data.rememberDevice ? await issueTrustedDevice(user.id, req) : undefined;
        res.json({ ...session, backupCodes, ...(deviceToken ? { deviceToken } : {}) });
    }
    catch (err) {
        next(err);
    }
});
router.get('/status', requireAuth, requireActiveUser, async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.auth.userId },
            select: { mfaEnabled: true, mfaEnrolledAt: true },
        });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        res.json({
            required: mfaRequiredForRole(req.auth.role),
            enabled: user.mfaEnabled,
            enrolledAt: user.mfaEnrolledAt?.toISOString() ?? null,
            backupCodesRemaining: user.mfaEnabled ? await countRemainingBackupCodes(req.auth.userId) : 0,
        });
    }
    catch (err) {
        next(err);
    }
});
/** New set of backup codes; needs a current authenticator code so a stolen session cannot do it. */
router.post('/backup-codes/regenerate', authRateLimiter, requireAuth, requireActiveUser, async (req, res, next) => {
    try {
        const parsed = z.object({ code: z.string().min(6).max(16) }).safeParse(req.body);
        if (!parsed.success)
            return res.status(400).json({ error: 'Enter your verification code' });
        const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
        if (!user || !user.mfaEnabled) {
            return res.status(409).json({ error: 'Multi-factor authentication is not set up', code: 'MFA_NOT_ENROLLED' });
        }
        if (!(await checkSecondFactor(user, parsed.data.code)))
            return rejectWrongCode(res, user.id);
        await clearMfaFailures(user.id);
        res.json({ backupCodes: await regenerateBackupCodes(user.id) });
    }
    catch (err) {
        next(err);
    }
});
/** "Lost my phone": only a Developer can clear a user's MFA; the user re-enrols at next sign-in. */
router.post('/reset/:userId', authRateLimiter, requireAuth, requireActiveUser, requireExactRoles('DEVELOPER'), async (req, res, next) => {
    try {
        const target = await prisma.user.findUnique({
            where: { id: String(req.params.userId) },
            select: { id: true, email: true },
        });
        if (!target)
            return res.status(404).json({ error: 'User not found' });
        await resetUserMfa(target.id);
        console.info(`[mfa] ${req.auth.email} reset MFA for ${target.email}`);
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
export default router;
