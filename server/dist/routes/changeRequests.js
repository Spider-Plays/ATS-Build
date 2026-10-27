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
    'TA_MANAGER',
    'FINANCE_HEAD',
    'RECRUITER',
    'TEAM_LEAD',
    'HIRING_MANAGER',
    'ACCOUNT_MANAGER',
    'INTERVIEWER',
    'HUMAN_RESOURCE',
    'VENDOR',
    'EMPLOYEE',
    'DEVELOPER',
];
const HR_REVIEW_ROLES = ['TA_MANAGER', 'HR_HEAD'];
const ADMIN_APPROVE_ROLES = ['ADMIN', 'SUPER_ADMIN'];
const DEVELOPER_ROLES = ['DEVELOPER'];
const DELETE_ROLES = ['SUPER_ADMIN', 'DEVELOPER'];
const ADMIN_CLOSE_ROLES = ADMIN_APPROVE_ROLES;
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
const OPEN_QUEUE_STATUSES = ['PENDING_HR', 'PENDING_ADMIN', 'PENDING_DEVELOPER', 'IN_PROCESS'];
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
        if (!HR_REVIEW_ROLES.includes(role) && role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'DEVELOPER') {
            return res.status(403).json({ error: 'Forbidden' });
        }
        where = { status: 'PENDING_HR' };
    }
    else if (tab === 'pending_admin') {
        if (!ADMIN_APPROVE_ROLES.includes(role) && !DEVELOPER_ROLES.includes(role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        where = { status: 'PENDING_ADMIN' };
    }
    else if (tab === 'pending_developer') {
        if (!DEVELOPER_ROLES.includes(role) && !ADMIN_APPROVE_ROLES.includes(role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        where = { status: 'PENDING_DEVELOPER' };
    }
    else if (tab === 'in_process') {
        if (!DEVELOPER_ROLES.includes(role) && !ADMIN_APPROVE_ROLES.includes(role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        where = { status: 'IN_PROCESS' };
    }
    else {
        // open — role-scoped view
        if (ADMIN_APPROVE_ROLES.includes(role) || DEVELOPER_ROLES.includes(role)) {
            where = { status: { in: OPEN_QUEUE_STATUSES } };
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
    const canAdmin = ADMIN_APPROVE_ROLES.includes(role);
    const canDeveloper = DEVELOPER_ROLES.includes(role);
    if (!isOwner && !canHr && !canAdmin && !canDeveloper) {
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
            status: 'PENDING_ADMIN',
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
        return res.status(403).json({ error: 'Only TA Manager can approve at this stage' });
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
        return res.status(403).json({ error: 'Only TA Manager can reject at this stage' });
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
router.post('/:id/approve-admin', async (req, res) => {
    if (!ADMIN_APPROVE_ROLES.includes(req.auth.role)) {
        return res.status(403).json({ error: 'Only Admin or Super Admin can approve' });
    }
    const parsed = hrReviewSchema.safeParse(req.body ?? {});
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed' });
    const row = await prisma.changeRequest.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Change request not found' });
    if (row.status !== 'PENDING_ADMIN') {
        return res.status(400).json({ error: 'Request is not pending admin approval' });
    }
    const reviewerName = await getUserName(req.auth.userId);
    const history = appendHistory(row.history, {
        action: 'ADMIN_APPROVED',
        by: req.auth.userId,
        byName: reviewerName,
        byRole: req.auth.role,
        comment: parsed.data.comment,
    });
    const updated = await prisma.changeRequest.update({
        where: { id: row.id },
        data: {
            status: 'PENDING_DEVELOPER',
            adminReviewedBy: req.auth.userId,
            adminReviewedByName: reviewerName,
            adminReviewedAt: new Date(),
            history,
        },
    });
    await logActivity({
        entityType: 'CHANGE_REQUEST',
        entityId: row.id,
        action: 'ADMIN_APPROVED',
        performedBy: req.auth.userId,
        performerName: reviewerName,
        performerRole: req.auth.role,
    });
    res.json(mapChangeRequest(updated));
});
router.post('/:id/reject-admin', async (req, res) => {
    if (!ADMIN_APPROVE_ROLES.includes(req.auth.role)) {
        return res.status(403).json({ error: 'Only Admin or Super Admin can reject at this stage' });
    }
    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed' });
    const row = await prisma.changeRequest.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Change request not found' });
    if (row.status !== 'PENDING_ADMIN') {
        return res.status(400).json({ error: 'Request is not pending admin approval' });
    }
    const reviewerName = await getUserName(req.auth.userId);
    const history = appendHistory(row.history, {
        action: 'ADMIN_REJECTED',
        by: req.auth.userId,
        byName: reviewerName,
        byRole: req.auth.role,
        comment: parsed.data.reason,
    });
    const updated = await prisma.changeRequest.update({
        where: { id: row.id },
        data: {
            status: 'REJECTED',
            adminReviewedBy: req.auth.userId,
            adminReviewedByName: reviewerName,
            adminReviewedAt: new Date(),
            closureComment: parsed.data.reason,
            closedBy: req.auth.userId,
            closedByName: reviewerName,
            closedAt: new Date(),
            history,
        },
    });
    await logActivity({
        entityType: 'CHANGE_REQUEST',
        entityId: row.id,
        action: 'ADMIN_REJECTED',
        performedBy: req.auth.userId,
        performerName: reviewerName,
        performerRole: req.auth.role,
        details: parsed.data.reason,
    });
    res.json(mapChangeRequest(updated));
});
const developerSchema = z.object({
    action: z.enum(['REJECT', 'DUPLICATE', 'START', 'COMPLETE']),
    comment: z.string().trim().max(2000).optional(),
});
router.post('/:id/developer', async (req, res) => {
    if (!DEVELOPER_ROLES.includes(req.auth.role)) {
        return res.status(403).json({ error: 'Only a Developer can update the request at this stage' });
    }
    const parsed = developerSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed' });
    const row = await prisma.changeRequest.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Change request not found' });
    const { action, comment } = parsed.data;
    const needsComment = action === 'REJECT' || action === 'DUPLICATE' || action === 'COMPLETE';
    if (needsComment && (!comment || comment.length < 3)) {
        return res.status(400).json({ error: 'A comment of at least 3 characters is required' });
    }
    if (action === 'COMPLETE' && row.status !== 'IN_PROCESS') {
        return res.status(400).json({ error: 'Only an in-process request can be marked completed' });
    }
    if (action !== 'COMPLETE' && row.status !== 'PENDING_DEVELOPER') {
        return res.status(400).json({ error: 'Request is not waiting on the developer' });
    }
    const nextStatus = action === 'REJECT'
        ? 'REJECTED'
        : action === 'DUPLICATE'
            ? 'DUPLICATE'
            : action === 'START'
                ? 'IN_PROCESS'
                : 'CLOSED';
    const historyAction = action === 'REJECT'
        ? 'DEVELOPER_REJECTED'
        : action === 'DUPLICATE'
            ? 'MARKED_DUPLICATE'
            : action === 'START'
                ? 'IN_PROCESS'
                : 'COMPLETED';
    const developerName = await getUserName(req.auth.userId);
    const history = appendHistory(row.history, {
        action: historyAction,
        by: req.auth.userId,
        byName: developerName,
        byRole: req.auth.role,
        comment,
    });
    const isTerminal = nextStatus === 'REJECTED' || nextStatus === 'DUPLICATE' || nextStatus === 'CLOSED';
    const updated = await prisma.changeRequest.update({
        where: { id: row.id },
        data: {
            status: nextStatus,
            history,
            ...(isTerminal
                ? {
                    closureComment: comment ?? null,
                    closedBy: req.auth.userId,
                    closedByName: developerName,
                    closedAt: new Date(),
                }
                : {}),
        },
    });
    await logActivity({
        entityType: 'CHANGE_REQUEST',
        entityId: row.id,
        action: historyAction,
        performedBy: req.auth.userId,
        performerName: developerName,
        performerRole: req.auth.role,
        details: comment,
    });
    res.json(mapChangeRequest(updated));
});
router.delete('/:id', async (req, res) => {
    if (!DELETE_ROLES.includes(req.auth.role)) {
        return res.status(403).json({ error: 'Only Super Admin or Developer can delete change requests' });
    }
    const row = await prisma.changeRequest.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Change request not found' });
    await prisma.changeRequest.delete({ where: { id: row.id } });
    const actorName = await getUserName(req.auth.userId);
    await logActivity({
        entityType: 'CHANGE_REQUEST',
        entityId: row.id,
        action: 'DELETED',
        performedBy: req.auth.userId,
        performerName: actorName,
        performerRole: req.auth.role,
        details: row.title,
    });
    res.status(204).end();
});
export default router;
