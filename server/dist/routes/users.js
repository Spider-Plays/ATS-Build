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
import { issuePasswordResetLink } from '../lib/passwordReset.js';
import { buildUserListWhere } from '../lib/userAccess.js';
import { sendInviteEmail } from '../services/email.js';
import { EMAIL_NOT_CONFIGURED_DEV_HINT, EMAIL_NOT_CONFIGURED_WARNING } from '../lib/safeError.js';
import { bumpTokenVersionAndRevoke } from '../lib/sessionTokens.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
const staffRoles = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
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
router.get('/', requireRoles('ADMIN', 'HR_HEAD', 'HR_MANAGER', 'RECRUITER', 'TEAM_LEAD', 'HIRING_MANAGER', 'ACCOUNT_MANAGER', 'INTERVIEWER'), async (req, res) => {
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
        temporaryPassword: z.string().min(8, 'Temporary password must be at least 8 characters'),
        sendInviteEmail: z.boolean().optional(),
    })
        .parse(req.body);
    if (body.role === 'SUPER_ADMIN' && req.auth.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Only Super Admin can create Super Admin accounts' });
    }
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
        return res.status(409).json({ error: 'A user with this email already exists' });
    const passwordHash = await bcrypt.hash(body.temporaryPassword, 10);
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
            mustChangePassword: true,
        },
    });
    if (!env.isProduction) {
        logTemporaryPassword('New user (share with member)', email, body.temporaryPassword);
    }
    const sendInvite = body.sendInviteEmail !== false;
    let inviteEmailSent;
    let inviteEmailWarning;
    let inviteDevHint;
    if (sendInvite) {
        const emailResult = await sendInviteEmail({
            to: user.email,
            name: user.name,
            role: user.role.replace(/_/g, ' '),
            tempPassword: body.temporaryPassword,
        });
        inviteEmailSent = emailResult.sent;
        if (!emailResult.sent && emailResult.reason === 'not_configured') {
            inviteEmailWarning = EMAIL_NOT_CONFIGURED_WARNING;
            if (!env.isProduction) {
                inviteDevHint = EMAIL_NOT_CONFIGURED_DEV_HINT;
            }
        }
    }
    res.status(201).json({
        user: mapUser(user),
        ...(sendInvite
            ? { inviteEmailSent, inviteEmailWarning, inviteDevHint }
            : { inviteEmailSent: false }),
    });
});
router.patch('/me', async (req, res) => {
    const body = z
        .object({
        name: z.string().min(1).optional(),
        phoneNumber: z.string().optional(),
        address: z.string().optional(),
        themePreference: z.enum(['light']).optional(),
        avatar: z.string().url().optional().or(z.literal('')),
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
    const entries = await prisma.loginHistory.findMany({
        where: { userId: req.params.id },
        orderBy: { loggedInAt: 'desc' },
        take: 200,
    });
    res.json(entries.map((e) => ({
        id: e.id,
        userId: e.userId,
        loggedInAt: e.loggedInAt.toISOString(),
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
router.patch('/:id', requireRoles('SUPER_ADMIN'), async (req, res) => {
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
router.post('/:id/send-password-reset-link', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target)
        return res.status(404).json({ error: 'User not found' });
    if (target.status === 'DISABLED') {
        return res.status(400).json({ error: 'Cannot send a reset link to a disabled account' });
    }
    await issuePasswordResetLink(target);
    res.json({ ok: true, message: `Password reset link sent to ${target.email}.` });
});
router.post('/:id/reset-password', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const body = z
        .object({
        newPassword: z.string().min(8).optional(),
        generateTemporary: z.boolean().optional(),
    })
        .refine((d) => Boolean(d.newPassword || d.generateTemporary), {
        message: 'Provide newPassword or set generateTemporary to true',
    })
        .parse(req.body);
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target)
        return res.status(404).json({ error: 'User not found' });
    const plainPassword = body.generateTemporary ? generateTempPassword() : body.newPassword;
    const passwordHash = await bcrypt.hash(plainPassword, 10);
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
    if (forceChangeOnLogin && !env.isProduction) {
        logTemporaryPassword('Admin temporary password (share with user)', target.email, plainPassword);
    }
    if (forceChangeOnLogin) {
        notifyAdminPasswordReset({ email: target.email, name: target.name }, plainPassword, true);
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
router.patch('/:id/tags', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const { tags } = z.object({ tags: z.array(z.string()) }).parse(req.body);
    const sanitized = sanitizeFeatureTags(tags);
    const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { permissions: JSON.stringify(sanitized) },
    });
    res.json(mapUser(user));
});
router.patch('/:id/role', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const { role } = z.object({ role: z.string() }).parse(req.body);
    if (role === 'SUPER_ADMIN' && req.auth.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Only Super Admin can assign the Super Admin role' });
    }
    if (req.params.id === req.auth.userId) {
        return res.status(400).json({ error: 'Cannot change your own role' });
    }
    const user = await prisma.user.update({
        where: { id: req.params.id },
        data: { role },
    });
    res.json(mapUser(user));
});
router.patch('/:id/status', requireRoles('SUPER_ADMIN'), async (req, res) => {
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
router.delete('/:id', requireRoles('SUPER_ADMIN'), async (req, res) => {
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
