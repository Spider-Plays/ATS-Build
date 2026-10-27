import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireActiveUser, requireExactRoles, requireRoles } from '../middleware/auth.js';
import { logActivity } from '../services/activityLog.js';
import { mapVendorOnboarding, mapVendorOnboardingStatus } from '../utils/mapVendorOnboarding.js';
import { computeScoring, emptyOnboardingForm, emptyEvaluationScores, parseEvaluationJson, parseOnboardingJson, validateEvaluationComplete, validateOnboardingComplete, HR_APPROVER_ROLES, HR_SCORE_ROLES, } from '../lib/vendorOnboarding.js';
import { mapVendor } from '../utils/mapVendor.js';
import { getUserEmailsByRoles } from '../lib/emailRecipients.js';
import { sendStaffNotificationEmail } from '../services/email.js';
import { env } from '../config/env.js';
import { clientErrorMessage } from '../lib/safeError.js';
const router = Router();
const VENDOR_MANAGERS = ['ADMIN', 'HR_HEAD', 'TA_MANAGER', 'RECRUITER', 'TEAM_LEAD', 'SUPER_ADMIN'];
async function ensureOnboardingRow(vendorId) {
    const existing = await prisma.vendorOnboarding.findUnique({ where: { vendorId } });
    if (existing)
        return existing;
    return prisma.vendorOnboarding.create({
        data: {
            vendorId,
            status: 'NOT_STARTED',
            onboardingJson: JSON.stringify(emptyOnboardingForm()),
            evaluationJson: JSON.stringify(emptyEvaluationScores()),
        },
    });
}
export async function createVendorOnboardingForNewVendor(vendorId) {
    return prisma.vendorOnboarding.create({
        data: {
            vendorId,
            status: 'NOT_STARTED',
            onboardingJson: JSON.stringify(emptyOnboardingForm()),
            evaluationJson: JSON.stringify(emptyEvaluationScores()),
        },
    });
}
async function notifyHrManagersSubmitted(vendorName, vendorId) {
    try {
        const recipients = await getUserEmailsByRoles([
            'TA_MANAGER',
            'HR_HEAD',
            'ADMIN',
            'SUPER_ADMIN',
            'DEVELOPER',
        ]);
        if (recipients.length === 0)
            return;
        const url = `${env.clientOrigin.replace(/\/$/, '')}/vendors/${vendorId}?tab=onboarding`;
        await Promise.all(recipients.map((r) => sendStaffNotificationEmail({
            to: r.email,
            recipientName: r.name,
            kind: 'vendorOnboardingSubmitted',
            vendorId,
            subject: `Vendor onboarding submitted — ${vendorName}`,
            headline: 'Vendor onboarding ready for review',
            body: `${vendorName} completed onboarding and evaluation and awaits TA Manager review. Review: ${url}`,
        })));
    }
    catch (err) {
        console.error('[vendor-onboarding] HR notify failed:', err);
    }
}
async function notifyHrHeadReview(vendorName, vendorId) {
    try {
        const recipients = await getUserEmailsByRoles(['HR_HEAD']);
        if (recipients.length === 0)
            return;
        const url = `${env.clientOrigin.replace(/\/$/, '')}/vendors/${vendorId}?tab=onboarding`;
        await Promise.all(recipients.map((r) => sendStaffNotificationEmail({
            to: r.email,
            recipientName: r.name,
            kind: 'vendorOnboardingHrReview',
            vendorId,
            subject: `Vendor onboarding ready for HR review — ${vendorName}`,
            headline: 'TA Manager approved — HR Head review',
            body: `${vendorName} was approved by the TA Manager and now needs your review. Review: ${url}`,
        })));
    }
    catch (err) {
        console.error('[vendor-onboarding] HR Head notify failed:', err);
    }
}
async function notifyVendorDecision(vendorId, vendorName, approved, reason) {
    try {
        const users = await prisma.user.findMany({
            where: { vendorId, role: 'VENDOR', status: 'ACTIVE' },
            select: { email: true, name: true },
        });
        if (users.length === 0)
            return;
        const url = `${env.clientOrigin.replace(/\/$/, '')}/vendor-portal/onboarding`;
        await Promise.all(users.map((u) => sendStaffNotificationEmail({
            to: u.email,
            recipientName: u.name,
            kind: approved ? 'vendorOnboardingApproved' : 'vendorOnboardingRevision',
            vendorId,
            subject: approved
                ? `Vendor onboarding approved — ${vendorName}`
                : `Vendor onboarding needs revision — ${vendorName}`,
            headline: approved ? 'Onboarding approved' : 'Onboarding rejected',
            body: approved
                ? `Your onboarding for ${vendorName} was approved. Open the portal: ${url}`
                : `Your onboarding for ${vendorName} was not approved. Feedback: ${reason}. Revise here: ${url}`,
        })));
    }
    catch (err) {
        console.error('[vendor-onboarding] vendor decision notify failed:', err);
    }
}
// ─── Staff: list pending / all packets ───────────────────────────────────────
router.get('/pending', requireAuth, requireActiveUser, requireExactRoles(...HR_APPROVER_ROLES), async (_req, res) => {
    try {
        const rows = await prisma.vendorOnboarding.findMany({
            where: { status: { in: ['SUBMITTED', 'TA_APPROVED'] } },
            orderBy: { submittedAt: 'asc' },
        });
        const vendorIds = rows.map((r) => r.vendorId);
        const vendors = vendorIds.length
            ? await prisma.vendor.findMany({ where: { id: { in: vendorIds } } })
            : [];
        const byId = new Map(vendors.map((v) => [v.id, v]));
        res.json(rows.map((r) => ({
            ...mapVendorOnboarding(r, { includeScoring: true }),
            vendor: byId.get(r.vendorId) ? mapVendor(byId.get(r.vendorId)) : null,
        })));
    }
    catch (err) {
        console.error('GET /api/vendor-onboarding/pending failed:', err);
        res.status(500).json({ error: clientErrorMessage(err) });
    }
});
router.get('/vendor/:vendorId', requireAuth, requireActiveUser, requireRoles(...VENDOR_MANAGERS), async (req, res) => {
    try {
        const vendor = await prisma.vendor.findUnique({ where: { id: req.params.vendorId } });
        if (!vendor)
            return res.status(404).json({ error: 'Vendor not found' });
        let row = await prisma.vendorOnboarding.findUnique({ where: { vendorId: vendor.id } });
        // Existing vendors created before this feature have no packet — treat as approved/grandfathered
        if (!row) {
            return res.json({
                vendor: mapVendor(vendor),
                onboarding: null,
                grandfathered: true,
            });
        }
        const includeScoring = HR_SCORE_ROLES.includes(req.auth.role);
        res.json({
            vendor: mapVendor(vendor),
            onboarding: mapVendorOnboarding(row, { includeScoring, role: req.auth.role }),
            grandfathered: false,
        });
    }
    catch (err) {
        console.error('GET /api/vendor-onboarding/vendor/:id failed:', err);
        res.status(500).json({ error: clientErrorMessage(err) });
    }
});
const decisionSchema = z.object({
    action: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().min(1, 'Reason is required'),
    strengths: z.string().optional(),
    improvements: z.string().optional(),
    risks: z.string().optional(),
    recommendation: z.string().optional(),
});
router.post('/vendor/:vendorId/decision', requireAuth, requireActiveUser, requireExactRoles('TA_MANAGER', 'HR_HEAD'), async (req, res) => {
    try {
        const body = decisionSchema.parse(req.body);
        const vendor = await prisma.vendor.findUnique({ where: { id: req.params.vendorId } });
        if (!vendor)
            return res.status(404).json({ error: 'Vendor not found' });
        const row = await prisma.vendorOnboarding.findUnique({ where: { vendorId: vendor.id } });
        if (!row)
            return res.status(404).json({ error: 'Onboarding packet not found' });
        const role = req.auth.role;
        const approver = await prisma.user.findUnique({ where: { id: req.auth.userId } });
        const approverName = approver?.name ?? req.auth.email;
        if (role === 'TA_MANAGER') {
            if (row.status !== 'SUBMITTED') {
                return res.status(400).json({ error: 'Packet is not awaiting TA Manager review' });
            }
        }
        else if (row.status !== 'TA_APPROVED') {
            return res.status(400).json({
                error: row.status === 'SUBMITTED'
                    ? 'Waiting for TA Manager approval before HR Head review'
                    : 'Packet is not awaiting HR Head review',
            });
        }
        const rejected = body.action === 'REJECT';
        const nextStatus = rejected ? 'REJECTED' : role === 'TA_MANAGER' ? 'TA_APPROVED' : 'APPROVED';
        const updated = await prisma.vendorOnboarding.update({
            where: { id: row.id },
            data: {
                status: nextStatus,
                evaluatorStrengths: body.strengths?.trim() || row.evaluatorStrengths,
                evaluatorImprovements: body.improvements?.trim() || row.evaluatorImprovements,
                evaluatorRisks: body.risks?.trim() || row.evaluatorRisks,
                evaluatorRecommendation: body.recommendation?.trim() || row.evaluatorRecommendation,
                ...(role === 'TA_MANAGER'
                    ? {
                        taReviewAction: body.action,
                        taReviewReason: body.reason.trim(),
                        taReviewedBy: req.auth.userId,
                        taReviewedByName: approverName,
                        taReviewedAt: new Date(),
                    }
                    : {}),
                ...(rejected || role === 'HR_HEAD'
                    ? {
                        decisionReason: body.reason.trim(),
                        decidedBy: req.auth.userId,
                        decidedByName: approverName,
                        decidedByRole: role,
                        decidedAt: new Date(),
                    }
                    : {}),
            },
        });
        await logActivity({
            entityType: 'VENDOR',
            entityId: vendor.id,
            action: nextStatus === 'APPROVED'
                ? 'ONBOARDING_APPROVED'
                : nextStatus === 'TA_APPROVED'
                    ? 'ONBOARDING_TA_APPROVED'
                    : 'ONBOARDING_REJECTED',
            performedBy: req.auth.userId,
            performerRole: role,
            details: { reason: body.reason.trim(), category: updated.category, stage: role },
        });
        if (nextStatus === 'TA_APPROVED') {
            void notifyHrHeadReview(vendor.name, vendor.id);
        }
        else {
            void notifyVendorDecision(vendor.id, vendor.name, nextStatus === 'APPROVED', body.reason.trim());
        }
        res.json(mapVendorOnboarding(updated, { includeScoring: true, role: req.auth.role }));
    }
    catch (err) {
        if (err instanceof z.ZodError) {
            return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid request' });
        }
        console.error('POST /api/vendor-onboarding/decision failed:', err);
        res.status(500).json({ error: clientErrorMessage(err) });
    }
});
export default router;
// ─── Vendor portal helpers (mounted from vendorPortal.ts) ────────────────────
export async function getPortalOnboardingContext(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.vendorId)
        return null;
    const vendor = await prisma.vendor.findUnique({ where: { id: user.vendorId } });
    if (!vendor || vendor.status !== 'ACTIVE')
        return null;
    const row = await prisma.vendorOnboarding.findUnique({ where: { vendorId: vendor.id } });
    return { user, vendor, row };
}
export { ensureOnboardingRow, mapVendorOnboardingStatus, notifyHrManagersSubmitted };
export function mergeOnboardingPatch(current, patch) {
    return {
        ...current,
        ...patch,
        references: Array.isArray(patch.references) ? patch.references : current.references,
        engagementTypes: Array.isArray(patch.engagementTypes)
            ? patch.engagementTypes.filter((t) => t === 'FULLTIME' || t === 'CONTRACT')
            : current.engagementTypes,
    };
}
export function mergeEvaluationPatch(current, patch) {
    const next = { ...current };
    for (const [key, val] of Object.entries(patch)) {
        next[key] = {
            fulltime: val?.fulltime ?? current[key]?.fulltime ?? null,
            contract: val?.contract ?? current[key]?.contract ?? null,
        };
    }
    return next;
}
export { computeScoring, parseOnboardingJson, parseEvaluationJson, validateOnboardingComplete, validateEvaluationComplete, };
