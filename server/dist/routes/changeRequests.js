import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireActiveUser } from '../middleware/auth.js';
import { logActivity } from '../services/activityLog.js';
import { CHANGE_REQUEST_MODULES } from '../lib/changeRequestModules.js';
const router = Router();
const SELF_SERVICE_ROLES = [
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
    'VENDOR',
    'EMPLOYEE',
];
const HR_REVIEW_ROLES = ['HR_MANAGER', 'HR_HEAD'];
const ADMIN_CLOSE_ROLES = ['ADMIN', 'SUPER_ADMIN'];
function parseHistory(raw) {
    try {
        const arr = JSON.parse(raw || '[]');
        return Array.isArray(arr) ? arr : [];
    }
    catch {
        return [];
    }
}
function appendHistory(existing, entry) {
    const history = parseHistory(existing);
    history.push({ ...entry, at: entry.at ?? new Date().toISOString() });
    return JSON.stringify(history);
}
function mapChangeRequest(row) {
    return {
        id: row.id,
        title: row.title,
        module: row.module,
        page: row.page ?? undefined,
        description: row.description,
        status: row.status,
        requestedBy: row.requestedBy,
        requestedByName: row.requestedByName,
        requestedByRole: row.requestedByRole,
        hrReviewedBy: row.hrReviewedBy ?? undefined,
        hrReviewedByName: row.hrReviewedByName ?? undefined,
        hrReviewedAt: row.hrReviewedAt?.toISOString(),
        hrComment: row.hrComment ?? undefined,
        adminReviewedBy: row.adminReviewedBy ?? undefined,
        adminReviewedByName: row.adminReviewedByName ?? undefined,
        adminReviewedAt: row.adminReviewedAt?.toISOString(),
        closureComment: row.closureComment ?? undefined,
        closedBy: row.closedBy ?? undefined,
        closedByName: row.closedByName ?? undefined,
        closedAt: row.closedAt?.toISOString(),
        history: parseHistory(row.history),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
function requireSelfServiceAccess(req, res, next) {
    if (!req.auth)
        return res.status(401).json({ error: 'Unauthorized' });
    if (req.auth.role === 'CANDIDATE') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!SELF_SERVICE_ROLES.includes(req.auth.role)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}
router.use(requireAuth, requireActiveUser, requireSelfServiceAccess);
const moduleKeys = CHANGE_REQUEST_MODULES.map((m) => m.key);
const createSchema = z.object({
    title: z.string().trim().min(3).max(200),
    module: z.enum(moduleKeys),
    page: z.string().trim().max(200).optional(),
    description: z.string().trim().min(10).max(5000),
});
const hrReviewSchema = z.object({
    comment: z.string().trim().max(2000).optional(),
});
const rejectSchema = z.object({
    reason: z.string().trim().min(3).max(2000),
});
const ADMIN_RESOLUTION_STATUSES = ['CLOSED', 'REJECTED', 'DEFERRED', 'DUPLICATE', 'WONT_FIX'];
const TERMINAL_STATUSES = [...ADMIN_RESOLUTION_STATUSES];
const closeSchema = z.object({
    status: z.enum(ADMIN_RESOLUTION_STATUSES).default('CLOSED'),
    comment: z.string().trim().min(3).max(2000),
});
async function getUserName(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name ?? 'Unknown';
}
router.get('/modules', (_req, res) => {
    res.json(CHANGE_REQUEST_MODULES);
});
router.get('/', async (req, res) => {
    const tab = typeof req.query.tab === 'string' ? req.query.tab : 'open';
    const role = req.auth.role;
    const userId = req.auth.userId;
    let where = {};
    if (tab === 'closed') {
        where = { status: { in: [...TERMINAL_STATUSES] } };
    }
    else if (tab === 'mine') {
        where = { requestedBy: userId };
    }
    else if (tab === 'pending_hr') {
        if (!HR_REVIEW_ROLES.includes(role) && role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
            return res.status(403).json({ error: 'Forbidden' });
        }
        where = { status: 'PENDING_HR' };
    }
    else if (tab === 'pending_admin') {
        if (!ADMIN_CLOSE_ROLES.includes(role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        where = { status: 'PENDING_ADMIN' };
    }
    else {
        // open — role-scoped view
        if (ADMIN_CLOSE_ROLES.includes(role)) {
            where = { status: { in: ['PENDING_HR', 'PENDING_ADMIN'] } };
        }
        else if (HR_REVIEW_ROLES.includes(role)) {
            where = { OR: [{ status: 'PENDING_HR' }, { requestedBy: userId }] };
        }
        else {
            where = { requestedBy: userId, status: { notIn: [...TERMINAL_STATUSES] } };
        }
    }
    const rows = await prisma.changeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
    });
    res.json(rows.map(mapChangeRequest));
});
router.get('/:id', async (req, res) => {
    const row = await prisma.changeRequest.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Change request not found' });
    const role = req.auth.role;
    const userId = req.auth.userId;
    const isOwner = row.requestedBy === userId;
    const canHr = HR_REVIEW_ROLES.includes(role);
    const canAdmin = ADMIN_CLOSE_ROLES.includes(role);
    if (!isOwner && !canHr && !canAdmin && role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(mapChangeRequest(row));
});
router.post('/', async (req, res) => {
    if (req.auth.role === 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Super Admin cannot submit change requests' });
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed' });
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user)
        return res.status(401).json({ error: 'Unauthorized' });
    const { title, module, page, description } = parsed.data;
    const history = appendHistory('[]', {
        action: 'SUBMITTED',
        by: user.id,
        byName: user.name,
        byRole: user.role,
        comment: 'Change request submitted',
    });
    const row = await prisma.changeRequest.create({
        data: {
            title,
            module,
            page: page || null,
            description,
            status: 'PENDING_HR',
            requestedBy: user.id,
            requestedByName: user.name,
            requestedByRole: user.role,
            history,
        },
    });
    await logActivity({
        entityType: 'CHANGE_REQUEST',
        entityId: row.id,
        action: 'SUBMITTED',
        performedBy: user.id,
        performerName: user.name,
        performerRole: user.role,
        details: title,
    });
    res.status(201).json(mapChangeRequest(row));
});
router.post('/:id/approve-hr', async (req, res) => {
    if (!HR_REVIEW_ROLES.includes(req.auth.role)) {
        return res.status(403).json({ error: 'Only HR Manager can approve at this stage' });
    }
    const parsed = hrReviewSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed' });
    const row = await prisma.changeRequest.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Change request not found' });
    if (row.status !== 'PENDING_HR') {
        return res.status(400).json({ error: 'Request is not pending HR review' });
    }
    const reviewerName = await getUserName(req.auth.userId);
    const history = appendHistory(row.history, {
        action: 'HR_APPROVED',
        by: req.auth.userId,
        byName: reviewerName,
        byRole: req.auth.role,
        comment: parsed.data.comment,
    });
    const updated = await prisma.changeRequest.update({
        where: { id: row.id },
        data: {
            status: 'PENDING_ADMIN',
            hrReviewedBy: req.auth.userId,
            hrReviewedByName: reviewerName,
            hrReviewedAt: new Date(),
            hrComment: parsed.data.comment ?? null,
            history,
        },
    });
    await logActivity({
        entityType: 'CHANGE_REQUEST',
        entityId: row.id,
        action: 'HR_APPROVED',
        performedBy: req.auth.userId,
        performerName: reviewerName,
        performerRole: req.auth.role,
    });
    res.json(mapChangeRequest(updated));
});
router.post('/:id/reject-hr', async (req, res) => {
    if (!HR_REVIEW_ROLES.includes(req.auth.role)) {
        return res.status(403).json({ error: 'Only HR Manager can reject at this stage' });
    }
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed' });
    const row = await prisma.changeRequest.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Change request not found' });
    if (row.status !== 'PENDING_HR') {
        return res.status(400).json({ error: 'Request is not pending HR review' });
    }
    const reviewerName = await getUserName(req.auth.userId);
    const history = appendHistory(row.history, {
        action: 'HR_REJECTED',
        by: req.auth.userId,
        byName: reviewerName,
        byRole: req.auth.role,
        comment: parsed.data.reason,
    });
    const updated = await prisma.changeRequest.update({
        where: { id: row.id },
        data: {
            status: 'REJECTED',
            hrReviewedBy: req.auth.userId,
            hrReviewedByName: reviewerName,
            hrReviewedAt: new Date(),
            hrComment: parsed.data.reason,
            closedBy: req.auth.userId,
            closedByName: reviewerName,
            closedAt: new Date(),
            history,
        },
    });
    await logActivity({
        entityType: 'CHANGE_REQUEST',
        entityId: row.id,
        action: 'HR_REJECTED',
        performedBy: req.auth.userId,
        performerName: reviewerName,
        performerRole: req.auth.role,
        details: parsed.data.reason,
    });
    res.json(mapChangeRequest(updated));
});
router.post('/:id/close', async (req, res) => {
    if (!ADMIN_CLOSE_ROLES.includes(req.auth.role)) {
        return res.status(403).json({ error: 'Only Admin can close change requests' });
    }
    const parsed = closeSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed' });
    const row = await prisma.changeRequest.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Change request not found' });
    if (row.status !== 'PENDING_ADMIN') {
        return res.status(400).json({ error: 'Request is not pending admin review' });
    }
    const resolutionStatus = parsed.data.status;
    const actionByStatus = {
        CLOSED: 'CLOSED',
        REJECTED: 'ADMIN_REJECTED',
        DEFERRED: 'DEFERRED',
        DUPLICATE: 'MARKED_DUPLICATE',
        WONT_FIX: 'WONT_FIX',
    };
    const action = actionByStatus[resolutionStatus];
    const adminName = await getUserName(req.auth.userId);
    const history = appendHistory(row.history, {
        action,
        by: req.auth.userId,
        byName: adminName,
        byRole: req.auth.role,
        comment: parsed.data.comment,
    });
    const updated = await prisma.changeRequest.update({
        where: { id: row.id },
        data: {
            status: resolutionStatus,
            adminReviewedBy: req.auth.userId,
            adminReviewedByName: adminName,
            adminReviewedAt: new Date(),
            closureComment: parsed.data.comment,
            closedBy: req.auth.userId,
            closedByName: adminName,
            closedAt: new Date(),
            history,
        },
    });
    await logActivity({
        entityType: 'CHANGE_REQUEST',
        entityId: row.id,
        action,
        performedBy: req.auth.userId,
        performerName: adminName,
        performerRole: req.auth.role,
        details: `${resolutionStatus}: ${parsed.data.comment}`,
    });
    res.json(mapChangeRequest(updated));
});
export default router;
