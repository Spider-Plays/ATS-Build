import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { mapUser } from '../utils/mappers.js';
import { mapVendor } from '../utils/mapVendor.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { generateTempPassword } from '../lib/password.js';
import { sendVendorInviteEmail } from '../services/email.js';
import { logActivity } from '../services/activityLog.js';
import { INTERNAL_ROLES } from '../lib/roles.js';
import { logTemporaryPassword } from '../lib/devPasswordLog.js';
import { clientErrorMessage, emailDeliveryErrorMessage, EMAIL_NOT_CONFIGURED_WARNING, EMAIL_TEMP_PASSWORD_DEV_HINT } from '../lib/safeError.js';
import { notifyVendorAssignment } from '../lib/emailDispatch.js';
import { buildVendorListWhere } from '../lib/vendorAccess.js';
import { createVendorOnboardingForNewVendor } from './vendorOnboarding.js';
import { mapActivityLog } from '../utils/mappers.js';
import { generateVendorCode } from '../lib/vendorCode.js';
import { REQUIREMENT_ASSIGNMENT_ROLES } from '../lib/requirementPermissions.js';
const router = Router();
const VENDOR_MANAGERS = ['ADMIN', 'HR_HEAD', 'HR_MANAGER', 'RECRUITER', 'TEAM_LEAD'];
async function getVendorOnboardingStatus(vendorId) {
    const row = await prisma.vendorOnboarding.findUnique({
        where: { vendorId },
        select: { status: true },
    });
    return row ? row.status : null;
}
function isVendorOnboardingApproved(status) {
    return status == null || status === 'APPROVED';
}
async function assertVendorApprovedForOps(vendorId) {
    const status = await getVendorOnboardingStatus(vendorId);
    if (!isVendorOnboardingApproved(status)) {
        return 'Vendor must complete onboarding and be approved before this action';
    }
    return null;
}
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
router.get('/', requireRoles(...VENDOR_MANAGERS), async (req, res) => {
    try {
        const listWhere = await buildVendorListWhere(req.auth);
        const vendors = await prisma.vendor.findMany({ where: listWhere, orderBy: { createdAt: 'desc' } });
        const vendorIds = vendors.map((v) => v.id);
        const onboardingRows = vendorIds.length
            ? await prisma.vendorOnboarding.findMany({
                where: { vendorId: { in: vendorIds } },
                select: { vendorId: true, status: true },
            })
            : [];
        const onboardingByVendor = new Map(onboardingRows.map((r) => [r.vendorId, r.status]));
        const enriched = await Promise.all(vendors.map(async (v) => {
            const [userCount, submissionCount, assignmentCount] = await Promise.all([
                prisma.user.count({ where: { vendorId: v.id, role: 'VENDOR' } }),
                prisma.candidate.count({ where: { vendorId: v.id } }),
                prisma.vendorRequirement.count({ where: { vendorId: v.id } }),
            ]);
            const rawStatus = onboardingByVendor.get(v.id);
            return mapVendor(v, {
                userCount,
                submissionCount,
                assignmentCount,
                onboardingStatus: rawStatus
                    ? rawStatus
                    : null,
            });
        }));
        res.json(enriched);
    }
    catch (err) {
        console.error('GET /api/vendors failed:', err);
        res.status(500).json({ error: clientErrorMessage(err) });
    }
});
router.get('/:id', requireRoles(...VENDOR_MANAGERS), async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor)
        return res.status(404).json({ error: 'Vendor not found' });
    const [users, assignments, submissions, onboarding] = await Promise.all([
        prisma.user.findMany({
            where: { vendorId: vendor.id, role: 'VENDOR' },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.vendorRequirement.findMany({
            where: { vendorId: vendor.id },
            orderBy: { assignedAt: 'desc' },
        }),
        prisma.candidate.findMany({
            where: { vendorId: vendor.id },
            orderBy: { createdAt: 'desc' },
            take: 50,
        }),
        prisma.vendorOnboarding.findUnique({
            where: { vendorId: vendor.id },
            select: { status: true },
        }),
    ]);
    const requirementIds = assignments.map((a) => a.requirementId);
    const requirements = requirementIds.length
        ? await prisma.requirement.findMany({ where: { id: { in: requirementIds } } })
        : [];
    const reqById = new Map(requirements.map((r) => [r.id, r]));
    res.json({
        ...mapVendor(vendor, {
            userCount: users.length,
            submissionCount: submissions.length,
            assignmentCount: assignments.length,
            onboardingStatus: onboarding
                ? onboarding.status
                : null,
        }),
        users: users.map(mapUser),
        assignments: assignments.map((a) => {
            const req = reqById.get(a.requirementId);
            return {
                id: a.id,
                requirementId: a.requirementId,
                assignedAt: a.assignedAt.toISOString(),
                title: req?.title,
                jobCode: req?.jobCode,
                status: req?.status,
                department: req?.department,
            };
        }),
        submissions: submissions.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            status: c.status,
            jobTitle: c.jobTitle,
            requirementId: c.requirementId,
            createdAt: c.createdAt.toISOString(),
        })),
    });
});
router.post('/', requireRoles(...VENDOR_MANAGERS), async (req, res) => {
    try {
        const body = z
            .object({
            name: z.string().min(1),
            email: z.string().email(),
            contactName: z.string().min(1, 'Primary contact is required'),
            // Ignored if sent — code is always auto-generated.
            code: z.string().max(32).optional(),
            phone: z.string().optional(),
            website: z.string().optional(),
            address: z.string().optional(),
            notes: z.string().optional(),
        })
            .parse(req.body);
        const primaryEmail = body.email.toLowerCase().trim();
        const existingUser = await prisma.user.findUnique({ where: { email: primaryEmail } });
        if (existingUser) {
            return res.status(409).json({
                error: `A user already exists for ${primaryEmail}. Use a different primary email so the vendor invite can be sent.`,
            });
        }
        const code = await generateVendorCode(body.name);
        const contactName = body.contactName.trim();
        const vendor = await prisma.vendor.create({
            data: {
                name: body.name.trim(),
                code,
                email: primaryEmail,
                phone: body.phone?.trim() || null,
                website: body.website?.trim() || null,
                address: body.address?.trim() || null,
                contactName,
                notes: body.notes?.trim() || null,
            },
        });
        const tempPassword = generateTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, 10);
        const user = await prisma.user.create({
            data: {
                email: primaryEmail,
                passwordHash,
                name: contactName,
                role: 'VENDOR',
                vendorId: vendor.id,
                status: 'ACTIVE',
                permissions: '[]',
                mustChangePassword: true,
            },
        });
        const emailResult = await sendVendorInviteEmail({
            to: primaryEmail,
            name: user.name,
            tempPassword,
            vendorName: vendor.name,
        });
        let inviteEmailWarning;
        let inviteDevHint;
        if (!emailResult.sent) {
            logTemporaryPassword('Vendor portal invite', primaryEmail, tempPassword);
            if (emailResult.reason === 'not_configured') {
                inviteEmailWarning = EMAIL_NOT_CONFIGURED_WARNING;
                if (process.env.NODE_ENV !== 'production') {
                    inviteDevHint = EMAIL_TEMP_PASSWORD_DEV_HINT;
                }
            }
            else {
                inviteEmailWarning = emailDeliveryErrorMessage(emailResult.reason === 'error' ? emailResult.message : undefined);
                if (process.env.NODE_ENV !== 'production') {
                    inviteDevHint = EMAIL_TEMP_PASSWORD_DEV_HINT;
                }
            }
        }
        try {
            await createVendorOnboardingForNewVendor(vendor.id);
        }
        catch (onboardingErr) {
            console.error('[vendors] Failed to create onboarding packet:', onboardingErr);
        }
        await logActivity({
            entityType: 'VENDOR',
            entityId: vendor.id,
            action: 'CREATED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: {
                name: vendor.name,
                code: vendor.code,
                primaryEmail,
                contactName,
                inviteEmailSent: emailResult.sent,
            },
        });
        res.status(201).json({
            vendor: mapVendor(vendor, { onboardingStatus: 'NOT_STARTED' }),
            invitedUser: mapUser(user),
            emailSent: emailResult.sent,
            ...(inviteEmailWarning ? { emailWarning: inviteEmailWarning } : {}),
            ...(inviteDevHint ? { devHint: inviteDevHint } : {}),
        });
    }
    catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.errors[0]?.message ?? 'Invalid request' });
        }
        console.error('POST /api/vendors failed:', err);
        res.status(500).json({ error: clientErrorMessage(err) });
    }
});
router.patch('/:id', requireRoles(...VENDOR_MANAGERS), async (req, res) => {
    const body = z
        .object({
        name: z.string().min(1).optional(),
        code: z.string().max(32).optional().nullable(),
        email: z.string().email().optional(),
        phone: z.string().optional().nullable(),
        website: z.string().optional().nullable(),
        address: z.string().optional().nullable(),
        contactName: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
    })
        .parse(req.body);
    const existing = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Vendor not found' });
    if (body.code !== undefined && body.code) {
        const dup = await prisma.vendor.findFirst({
            where: { code: body.code.toUpperCase(), NOT: { id: req.params.id } },
        });
        if (dup)
            return res.status(409).json({ error: 'Vendor code already exists' });
    }
    const row = await prisma.vendor.update({
        where: { id: req.params.id },
        data: {
            ...(body.name !== undefined && { name: body.name.trim() }),
            ...(body.code !== undefined && { code: body.code ? body.code.toUpperCase() : null }),
            ...(body.email !== undefined && { email: body.email.toLowerCase().trim() }),
            ...(body.phone !== undefined && { phone: body.phone }),
            ...(body.website !== undefined && { website: body.website }),
            ...(body.address !== undefined && { address: body.address }),
            ...(body.contactName !== undefined && { contactName: body.contactName }),
            ...(body.notes !== undefined && { notes: body.notes }),
            ...(body.status !== undefined && { status: body.status }),
        },
    });
    await logActivity({
        entityType: 'VENDOR',
        entityId: row.id,
        action: body.status !== undefined ? 'STATUS_CHANGED' : 'UPDATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {
            ...(body.status !== undefined ? { status: body.status, previousStatus: existing.status } : {}),
            fields: Object.keys(body),
        },
    });
    const onboardingStatus = await getVendorOnboardingStatus(row.id);
    res.json(mapVendor(row, { onboardingStatus }));
});
router.get('/:id/activity-logs', requireRoles(...VENDOR_MANAGERS), async (req, res) => {
    try {
        const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
        if (!vendor)
            return res.status(404).json({ error: 'Vendor not found' });
        const limit = Math.min(Number(req.query.limit) || 80, 200);
        const rows = await prisma.activityLog.findMany({
            where: { entityType: 'VENDOR', entityId: vendor.id },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });
        res.json(rows.map(mapActivityLog));
    }
    catch (err) {
        console.error('GET /api/vendors/:id/activity-logs failed:', err);
        res.status(500).json({ error: clientErrorMessage(err) });
    }
});
router.post('/:id/assignments', requireRoles(...REQUIREMENT_ASSIGNMENT_ROLES), async (req, res) => {
    const { requirementIds } = z
        .object({ requirementIds: z.array(z.string().min(1)).min(1) })
        .parse(req.body);
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor)
        return res.status(404).json({ error: 'Vendor not found' });
    const blocked = await assertVendorApprovedForOps(vendor.id);
    if (blocked)
        return res.status(400).json({ error: blocked });
    const requirements = await prisma.requirement.findMany({
        where: { id: { in: requirementIds }, status: 'LIVE' },
    });
    if (requirements.length === 0) {
        return res.status(400).json({ error: 'No valid LIVE requirements to assign' });
    }
    await prisma.vendorRequirement.createMany({
        data: requirements.map((r) => ({
            vendorId: vendor.id,
            requirementId: r.id,
            assignedBy: req.auth.userId,
        })),
        skipDuplicates: true,
    });
    await prisma.requirement.updateMany({
        where: { id: { in: requirements.map((r) => r.id) } },
        data: { visibleToVendors: true },
    });
    notifyVendorAssignment({ id: vendor.id, name: vendor.name }, requirements.map((r) => ({ title: r.title, jobCode: r.jobCode })));
    await logActivity({
        entityType: 'VENDOR',
        entityId: vendor.id,
        action: 'JOBS_ASSIGNED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {
            requirementIds: requirements.map((r) => r.id),
            titles: requirements.map((r) => r.title),
        },
    });
    res.json({ assigned: requirements.map((r) => r.id) });
});
router.delete('/:id/assignments/:requirementId', requireRoles(...REQUIREMENT_ASSIGNMENT_ROLES), async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor)
        return res.status(404).json({ error: 'Vendor not found' });
    const blocked = await assertVendorApprovedForOps(vendor.id);
    if (blocked)
        return res.status(400).json({ error: blocked });
    const requirement = await prisma.requirement.findUnique({
        where: { id: req.params.requirementId },
        select: { id: true, title: true, jobCode: true },
    });
    await prisma.vendorRequirement.deleteMany({
        where: {
            vendorId: req.params.id,
            requirementId: req.params.requirementId,
        },
    });
    await logActivity({
        entityType: 'VENDOR',
        entityId: vendor.id,
        action: 'JOB_UNASSIGNED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {
            requirementId: req.params.requirementId,
            title: requirement?.title,
            jobCode: requirement?.jobCode,
        },
    });
    res.status(204).send();
});
router.post('/:id/invite', requireRoles(...VENDOR_MANAGERS), async (req, res) => {
    const body = z
        .object({
        email: z.string().email(),
        name: z.string().min(1).optional(),
    })
        .parse(req.body);
    const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
    if (!vendor)
        return res.status(404).json({ error: 'Vendor not found' });
    if (vendor.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'Vendor must be active to invite users' });
    }
    const blocked = await assertVendorApprovedForOps(vendor.id);
    if (blocked)
        return res.status(400).json({ error: blocked });
    const email = body.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
        return res.status(409).json({ error: 'A user with this email already exists' });
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const user = await prisma.user.create({
        data: {
            email,
            passwordHash,
            name: body.name?.trim() || email.split('@')[0],
            role: 'VENDOR',
            vendorId: vendor.id,
            status: 'ACTIVE',
            permissions: '[]',
        },
    });
    const emailResult = await sendVendorInviteEmail({
        to: email,
        name: user.name,
        tempPassword,
        vendorName: vendor.name,
    });
    if (!emailResult.sent) {
        logTemporaryPassword('Vendor user invite', email, tempPassword);
    }
    await logActivity({
        entityType: 'VENDOR',
        entityId: vendor.id,
        action: 'USER_INVITED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { email, name: user.name, emailSent: emailResult.sent },
    });
    res.status(201).json({
        user: mapUser(user),
        emailSent: emailResult.sent,
        ...(!emailResult.sent
            ? {
                emailWarning: emailResult.reason === 'not_configured'
                    ? EMAIL_NOT_CONFIGURED_WARNING
                    : emailDeliveryErrorMessage(emailResult.reason === 'error' ? emailResult.message : undefined),
                ...(process.env.NODE_ENV !== 'production'
                    ? { devHint: EMAIL_TEMP_PASSWORD_DEV_HINT }
                    : {}),
            }
            : {}),
    });
});
/** Super Admin: reset credentials and resend invite to the vendor primary email. */
router.post('/:id/reinvite', requireRoles('SUPER_ADMIN'), async (req, res) => {
    try {
        const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
        if (!vendor)
            return res.status(404).json({ error: 'Vendor not found' });
        const primaryEmail = vendor.email.toLowerCase().trim();
        let user = await prisma.user.findUnique({ where: { email: primaryEmail } });
        if (user && (user.role !== 'VENDOR' || user.vendorId !== vendor.id)) {
            return res.status(409).json({
                error: `Cannot reinvite — ${primaryEmail} belongs to another account (${user.role}).`,
            });
        }
        const tempPassword = generateTempPassword();
        const passwordHash = await bcrypt.hash(tempPassword, 10);
        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: primaryEmail,
                    passwordHash,
                    name: vendor.contactName?.trim() || vendor.name,
                    role: 'VENDOR',
                    vendorId: vendor.id,
                    status: 'ACTIVE',
                    permissions: '[]',
                    mustChangePassword: true,
                },
            });
        }
        else {
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    passwordHash,
                    mustChangePassword: true,
                    status: 'ACTIVE',
                    vendorId: vendor.id,
                },
            });
        }
        const emailResult = await sendVendorInviteEmail({
            to: primaryEmail,
            name: user.name,
            tempPassword,
            vendorName: vendor.name,
        });
        let emailWarning;
        let devHint;
        if (!emailResult.sent) {
            logTemporaryPassword('Vendor portal reinvite', primaryEmail, tempPassword);
            if (emailResult.reason === 'not_configured') {
                emailWarning = EMAIL_NOT_CONFIGURED_WARNING;
                if (process.env.NODE_ENV !== 'production')
                    devHint = EMAIL_TEMP_PASSWORD_DEV_HINT;
            }
            else {
                emailWarning = emailDeliveryErrorMessage(emailResult.reason === 'error' ? emailResult.message : undefined);
                if (process.env.NODE_ENV !== 'production')
                    devHint = EMAIL_TEMP_PASSWORD_DEV_HINT;
            }
        }
        await logActivity({
            entityType: 'VENDOR',
            entityId: vendor.id,
            action: 'INVITE_RESENT',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: { email: primaryEmail, emailSent: emailResult.sent },
        });
        res.json({
            user: mapUser(user),
            emailSent: emailResult.sent,
            ...(emailWarning ? { emailWarning } : {}),
            ...(devHint ? { devHint } : {}),
        });
    }
    catch (err) {
        console.error('POST /api/vendors/:id/reinvite failed:', err);
        res.status(500).json({ error: clientErrorMessage(err) });
    }
});
/** Super Admin: permanently delete a vendor (allowed before or after onboarding approval). */
router.delete('/:id', requireRoles('SUPER_ADMIN'), async (req, res) => {
    try {
        const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
        if (!vendor)
            return res.status(404).json({ error: 'Vendor not found' });
        await prisma.$transaction(async (tx) => {
            await tx.vendorRequirement.deleteMany({ where: { vendorId: vendor.id } });
            await tx.vendorOnboarding.deleteMany({ where: { vendorId: vendor.id } });
            await tx.candidate.updateMany({
                where: { vendorId: vendor.id },
                data: { vendorId: null },
            });
            await tx.user.deleteMany({ where: { vendorId: vendor.id, role: 'VENDOR' } });
            await tx.vendor.delete({ where: { id: vendor.id } });
        });
        await logActivity({
            entityType: 'VENDOR',
            entityId: vendor.id,
            action: 'DELETED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: { name: vendor.name, email: vendor.email },
        });
        res.status(204).send();
    }
    catch (err) {
        console.error('DELETE /api/vendors/:id failed:', err);
        res.status(500).json({ error: clientErrorMessage(err) });
    }
});
export default router;
