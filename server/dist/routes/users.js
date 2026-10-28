import { BCRYPT_ROUNDS, newPasswordSchema, personalInfoPasswordError } from '../lib/passwordPolicy.js';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { mapUser } from '../utils/mappers.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { generateTempPassword } from '../lib/password.js';
import { sanitizeFeatureTags } from '../lib/userTags.js';
import { logTemporaryPassword } from '../lib/devPasswordLog.js';
import { env } from '../config/env.js';
import { notifyAdminPasswordReset } from '../lib/emailDispatch.js';
import { createPasswordSetupLink, issuePasswordResetLink } from '../lib/passwordReset.js';
import { unusablePasswordHash } from '../lib/legacyImport/unusablePassword.js';
import { buildUserListWhere } from '../lib/userAccess.js';
import { sendInviteEmail } from '../services/email.js';
import { EMAIL_NOT_CONFIGURED_DEV_HINT, EMAIL_NOT_CONFIGURED_WARNING } from '../lib/safeError.js';
import { bumpTokenVersionAndRevoke } from '../lib/sessionTokens.js';
import { listLoginHistory } from '../lib/recordLogin.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
const staffRoles = [
    'SUPER_ADMIN',
    'DEVELOPER',
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
    'HUMAN_RESOURCE',
    'FINANCE_HEAD',
    'RECRUITER',
    'TEAM_LEAD',
    'HIRING_MANAGER',
    'ACCOUNT_MANAGER',
    'INTERVIEWER',
    'CANDIDATE',
    'VENDOR',
    'EMPLOYEE',
];
/**
 * Role hierarchy for account management: only Developer manages Developer accounts,
 * and only Super Admin or Developer manages Super Admin accounts.
 */
function canManageRole(actorRole, targetRole) {
    if (targetRole === 'DEVELOPER')
        return actorRole === 'DEVELOPER';
    if (targetRole === 'SUPER_ADMIN')
        return actorRole === 'SUPER_ADMIN' || actorRole === 'DEVELOPER';
    return true;
}
/** Blocks changes to an account whose role sits above the caller's. */
async function requireManageableTarget(req, res, next) {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true } });
    if (!target)
        return res.status(404).json({ error: 'User not found' });
    if (!canManageRole(req.auth.role, target.role)) {
        return res.status(403).json({ error: 'You cannot change this account' });
    }
    next();
}
router.get('/', requireRoles('ADMIN', 'HR_HEAD', 'TA_MANAGER', 'RECRUITER', 'TEAM_LEAD', 'HIRING_MANAGER', 'ACCOUNT_MANAGER', 'INTERVIEWER'), async (req, res) => {
    const listWhere = await buildUserListWhere(req.auth);
    const users = await prisma.user.findMany({ where: listWhere, orderBy: { createdAt: 'desc' } });
    res.json(users.map(mapUser));
});
router.post('/', requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res) => {
    const body = z
        .object({
        email: z.string().email(),
        name: z.string().min(1, 'Name is required'),
        role: z.enum(staffRoles),
        department: z.string().max(120).optional(),
        phoneNumber: z.string().max(40).optional(),
        address: z.string().max(500).optional(),
        /** Only when no invite email is sent: the admin hands this to the member in person. */
        temporaryPassword: newPasswordSchema.optional(),
        sendInviteEmail: z.boolean().optional(),
    })
        .parse(req.body);
    if (!canManageRole(req.auth.role, body.role)) {
        return res.status(403).json({ error: 'You cannot create an account with this role' });
    }
    const sendInvite = body.sendInviteEmail !== false;
    if (!sendInvite && !body.temporaryPassword) {
        return res.status(400).json({ error: 'Set a temporary password, or send an invite email instead' });
    }
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
        return res.status(409).json({ error: 'A user with this email already exists' });
    if (!sendInvite) {
        const personalError = personalInfoPasswordError(body.temporaryPassword, { email, name: body.name });
        if (personalError)
            return res.status(400).json({ error: personalError });
    }
    // Invited members choose their own password from the emailed link; nobody else ever knows it.
    const passwordHash = sendInvite
        ? await unusablePasswordHash()
        : await bcrypt.hash(body.temporaryPassword, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
        data: {
            email,
            passwordHash,
            name: body.name.trim(),
            role: body.role,
            department: body.department?.trim() || null,
            phoneNumber: body.phoneNumber?.trim() || null,
            address: body.address?.trim() || null,
            status: 'ACTIVE',
            permissions: '[]',
            themePreference: 'light',
            authProvider: 'local',
            mustChangePassword: !sendInvite,
            mustCompleteProfile: true,
        },
    });
    if (!sendInvite) {
        if (!env.isProduction) {
            logTemporaryPassword('New user (share with member)', email, body.temporaryPassword);
        }
        return res.status(201).json({ user: mapUser(user), inviteEmailSent: false });
    }
    const setupUrl = await createPasswordSetupLink(user, req);
    const emailResult = await sendInviteEmail({
        to: user.email,
        name: user.name,
        role: user.role.replace(/_/g, ' '),
        setupUrl,
    });
    let inviteEmailWarning;
    let inviteDevHint;
    if (!emailResult.sent && emailResult.reason === 'not_configured') {
        inviteEmailWarning = EMAIL_NOT_CONFIGURED_WARNING;
        if (!env.isProduction) {
            inviteDevHint = EMAIL_NOT_CONFIGURED_DEV_HINT;
        }
    }
    res.status(201).json({
        user: mapUser(user),
        inviteEmailSent: emailResult.sent,
        inviteEmailWarning,
        inviteDevHint,
        // Undelivered invite: give the admin the one-time link to pass on, never a password.
        ...(emailResult.sent ? {} : { setupUrl }),
    });
});
router.post('/me/complete-profile', async (req, res) => {
    const body = z
        .object({
        phoneNumber: z.string().trim().min(7, 'Enter a valid phone number').max(40),
        designation: z.string().trim().min(2, 'Enter your designation').max(120),
    })
        .parse(req.body);
    const user = await prisma.user.update({
        where: { id: req.auth.userId },
        data: {
            phoneNumber: body.phoneNumber,
            address: body.designation,
            mustCompleteProfile: false,
        },
    });
    res.json(mapUser(user));
});
router.patch('/me', async (req, res) => {
    const body = z
        .object({
        name: z.string().min(1).optional(),
        phoneNumber: z.string().optional(),
        address: z.string().optional(),
        themePreference: z.enum(['light']).optional(),
        avatar: z
            .string()
            .url()
            .refine((v) => /^https?:\/\//i.test(v), 'Avatar must be an http(s) URL')
            .optional()
            .or(z.literal('')),
    })
        .parse(req.body);
    const user = await prisma.user.update({
        where: { id: req.auth.userId },
        data: {
            ...(body.name !== undefined && { name: body.name.trim() }),
            ...(body.phoneNumber !== undefined && { phoneNumber: body.phoneNumber || null }),
            ...(body.address !== undefined && { address: body.address || null }),
            ...(body.themePreference !== undefined && { themePreference: body.themePreference }),
            ...(body.avatar !== undefined && { avatar: body.avatar || null }),
        },
    });
    res.json(mapUser(user));
});
router.get('/:id/login-history', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user)
        return res.status(404).json({ error: 'Not found' });
    const entries = await listLoginHistory(req.params.id);
    res.json(entries.map((e) => ({
        id: e.id,
        userId: e.userId,
        loggedInAt: e.loggedInAt.toISOString(),
        loggedOutAt: e.loggedOutAt?.toISOString(),
        logoutReason: e.logoutReason ?? undefined,
        ipAddress: e.ipAddress ?? undefined,
        userAgent: e.userAgent ?? undefined,
    })));
});
router.get('/:id', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user)
        return res.status(404).json({ error: 'Not found' });
    res.json(mapUser(user));
});
router.patch('/:id', requireRoles('SUPER_ADMIN'), requireManageableTarget, async (req, res) => {
    const body = z
        .object({
        email: z.string().email().optional(),
        name: z.string().min(1).optional(),
        department: z.string().max(120).optional().nullable(),
        phoneNumber: z.string().max(40).optional().nullable(),
        address: z.string().max(500).optional().nullable(),
    })
        .parse(req.body);
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'User not found' });
    let nextEmail;
    if (body.email !== undefined) {
        nextEmail = body.email.toLowerCase().trim();
        if (nextEmail !== existing.email) {
            if (req.auth.role !== 'DEVELOPER') {
                return res.status(403).json({ error: 'Only Developer can change a user email' });
            }
            const conflict = await prisma.user.findUnique({ where: { email: nextEmail } });
            if (conflict) {
                return res.status(409).json({ error: 'A user with this email already exists' });
            }
        }
        else {
            nextEmail = undefined;
        }
    }
    const user = await prisma.user.update({
        where: { id: req.params.id },
        data: {
            ...(nextEmail !== undefined && { email: nextEmail }),
            ...(body.name !== undefined && { name: body.name.trim() }),
            ...(body.department !== undefined && {
                department: body.department?.trim() || null,
            }),
            ...(body.phoneNumber !== undefined && {
                phoneNumber: body.phoneNumber?.trim() || null,
            }),
            ...(body.address !== undefined && {
                address: body.address?.trim() || null,
            }),
        },
    });
    res.json(mapUser(user));
});
router.post('/:id/send-password-reset-link', requireRoles('SUPER_ADMIN'), requireManageableTarget, async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target)
        return res.status(404).json({ error: 'User not found' });
    if (target.status === 'DISABLED') {
        return res.status(400).json({ error: 'Cannot send a reset link to a disabled account' });
    }
    await issuePasswordResetLink(target, req);
    res.json({ ok: true, message: `Password reset link sent to ${target.email}.` });
});
/** Clears a failed-sign-in lockout. requireRoles always admits Super Admin and Developer only here. */
router.post('/:id/unlock', requireRoles('SUPER_ADMIN'), requireManageableTarget, async (req, res) => {
    const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { lockedAt: null, failedLoginAttempts: 0, mfaFailedAttempts: 0 },
    });
    res.json(mapUser(user));
});
router.post('/:id/reset-password', requireRoles('SUPER_ADMIN'), requireManageableTarget, async (req, res) => {
    const body = z
        .object({
        newPassword: newPasswordSchema.optional(),
        generateTemporary: z.boolean().optional(),
    })
        .refine((d) => Boolean(d.newPassword || d.generateTemporary), {
        message: 'Provide newPassword or set generateTemporary to true',
    })
        .parse(req.body);
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target)
        return res.status(404).json({ error: 'User not found' });
    if (body.newPassword) {
        const personalError = personalInfoPasswordError(body.newPassword, target);
        if (personalError)
            return res.status(400).json({ error: personalError });
    }
    const plainPassword = body.generateTemporary ? generateTempPassword() : body.newPassword;
    const passwordHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
    const forceChangeOnLogin = Boolean(body.generateTemporary);
    await prisma.user.update({
        where: { id: target.id },
        data: {
            passwordHash,
            mustChangePassword: forceChangeOnLogin,
            passwordResetToken: null,
            passwordResetExpires: null,
        },
    });
    await bumpTokenVersionAndRevoke(target.id);
    if (forceChangeOnLogin && !env.isProduction) {
        logTemporaryPassword('Admin temporary password (share with user)', target.email, plainPassword);
    }
    if (forceChangeOnLogin) {
        notifyAdminPasswordReset({ email: target.email, name: target.name }, true);
    }
    res.json({
        ok: true,
        ...(forceChangeOnLogin
            ? {
                temporaryPassword: plainPassword,
                message: 'Share this temporary password with the user. They must change it on first sign-in.',
            }
            : { message: 'Password updated.' }),
    });
});
router.patch('/:id/tags', requireRoles('SUPER_ADMIN'), requireManageableTarget, async (req, res) => {
    const { tags } = z.object({ tags: z.array(z.string()) }).parse(req.body);
    const sanitized = sanitizeFeatureTags(tags);
    const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { permissions: JSON.stringify(sanitized) },
    });
    res.json(mapUser(user));
});
router.patch('/:id/role', requireRoles('SUPER_ADMIN'), requireManageableTarget, async (req, res) => {
    const { role } = z.object({ role: z.enum(staffRoles) }).parse(req.body);
    if (!canManageRole(req.auth.role, role)) {
        return res.status(403).json({ error: 'You cannot assign this role' });
    }
    if (req.params.id === req.auth.userId) {
        return res.status(400).json({ error: 'Cannot change your own role' });
    }
    const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { role },
    });
    await bumpTokenVersionAndRevoke(user.id);
    res.json(mapUser(user));
});
router.patch('/:id/status', requireRoles('SUPER_ADMIN'), requireManageableTarget, async (req, res) => {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).parse(req.body);
    if (req.params.id === req.auth.userId) {
        return res.status(400).json({ error: 'Cannot change your own status' });
    }
    const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { status },
    });
    if (status === 'DISABLED') {
        await bumpTokenVersionAndRevoke(user.id);
    }
    res.json(mapUser(user));
});
router.delete('/:id', requireRoles('SUPER_ADMIN'), requireManageableTarget, async (req, res) => {
    if (req.params.id === req.auth.userId) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    await prisma.user.delete({ where: { id: user.id } });
    res.status(204).send();
});
export default router;
