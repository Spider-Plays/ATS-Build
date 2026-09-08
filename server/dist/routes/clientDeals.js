import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { mapBusinessRequirement, mapClientDeal } from '../utils/mappers.js';
import { logActivity } from '../services/activityLog.js';
import { parseRequirementClientInput, resolveClientFromCatalog, } from '../lib/clientCatalog.js';
import { BUSINESS_MUTATE_ROLES, BUSINESS_VIEW_ROLES, BusinessRequirementAccessError, assertCanMutateClientDeal, assertCanViewClientDeal, buildClientDealListWhere, } from '../lib/clientDealAccess.js';
import { clientDealStagePercentage, businessStagePercentage, isClientDealStageKey, isBusinessStageRollback, STAGE_ROLLBACK_ERROR, } from '../lib/businessStages.js';
import { syncClientDealEngagementFromRequirements } from '../lib/syncClientDealEngagement.js';
import { confirmLinkedRequirementsOnSowSigned } from '../lib/confirmLinkedRequirementsOnSowSigned.js';
import { parseBusinessStageHistory } from '../lib/businessRequirementStageHistory.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
function parseStageHistory(raw) {
    return parseBusinessStageHistory(raw);
}
router.get('/', requireRoles(...BUSINESS_MUTATE_ROLES), async (req, res) => {
    const listWhere = await buildClientDealListWhere(req.auth);
    const rows = await prisma.clientDeal.findMany({
        where: listWhere,
        orderBy: { updatedAt: 'desc' },
    });
    const ids = rows.map((r) => r.id);
    const [counts, linkedRequirements] = await Promise.all([
        ids.length === 0
            ? Promise.resolve([])
            : prisma.businessRequirement.groupBy({
                by: ['clientDealId'],
                where: { clientDealId: { in: ids } },
                _count: { _all: true },
            }),
        ids.length === 0
            ? Promise.resolve([])
            : prisma.businessRequirement.findMany({
                where: { clientDealId: { in: ids } },
                select: { clientDealId: true, businessStage: true, stagePercentage: true },
            }),
    ]);
    const countByDealId = new Map(counts
        .filter((c) => c.clientDealId)
        .map((c) => [c.clientDealId, c._count._all]));
    const furthestByDealId = new Map();
    for (const req of linkedRequirements) {
        if (!req.clientDealId)
            continue;
        const existing = furthestByDealId.get(req.clientDealId);
        if (!existing || req.stagePercentage > existing.stagePercentage) {
            furthestByDealId.set(req.clientDealId, {
                businessStage: req.businessStage,
                stagePercentage: req.stagePercentage,
            });
        }
    }
    res.json(rows.map((row) => {
        const furthest = furthestByDealId.get(row.id);
        return mapClientDeal(row, {
            requirementCount: countByDealId.get(row.id) ?? 0,
            furthestRequirementStage: furthest?.businessStage,
            furthestRequirementPercentage: furthest?.stagePercentage,
        });
    }));
});
router.post('/', requireRoles(...BUSINESS_MUTATE_ROLES), async (req, res) => {
    const body = req.body;
    let clientName;
    try {
        clientName = await resolveClientFromCatalog(parseRequirementClientInput(body.client));
    }
    catch (e) {
        return res.status(400).json({
            error: e instanceof Error ? e.message : 'Invalid client',
        });
    }
    const accountManager = typeof body.accountManager === 'string' && body.accountManager.trim()
        ? body.accountManager.trim()
        : req.auth.userId;
    const hiringManager = typeof body.hiringManager === 'string' && body.hiringManager.trim()
        ? body.hiringManager.trim()
        : req.auth.userId;
    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    const initialStage = 'INITIAL_DISCUSSION';
    const initialPercentage = clientDealStagePercentage(initialStage);
    const timestamp = new Date().toISOString();
    const row = await prisma.clientDeal.create({
        data: {
            client: clientName,
            accountManager,
            hiringManager,
            notes,
            businessStage: initialStage,
            stagePercentage: initialPercentage,
            status: 'ACTIVE',
            createdBy: req.auth.userId,
            createdByRole: req.auth.role,
            stageHistory: JSON.stringify([
                {
                    stage: initialStage,
                    percentage: initialPercentage,
                    by: req.auth.userId,
                    at: timestamp,
                    role: req.auth.role,
                },
            ]),
        },
    });
    await logActivity({
        entityType: 'CLIENT_DEAL',
        entityId: row.id,
        action: 'CREATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { client: row.client },
    });
    res.status(201).json(mapClientDeal(row));
});
router.get('/:id', requireRoles(...BUSINESS_VIEW_ROLES), async (req, res) => {
    try {
        await assertCanViewClientDeal(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof BusinessRequirementAccessError) {
            const status = err.message === 'Not found' ? 404 : 403;
            return res.status(status).json({ error: err.message });
        }
        throw err;
    }
    const row = await prisma.clientDeal.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Not found' });
    const requirements = await prisma.businessRequirement.findMany({
        where: { clientDealId: req.params.id },
        orderBy: { createdAt: 'desc' },
    });
    const furthest = requirements.reduce((best, req) => !best || req.stagePercentage > best.stagePercentage
        ? { businessStage: req.businessStage, stagePercentage: req.stagePercentage }
        : best, null);
    if (requirements.length > 0) {
        await syncClientDealEngagementFromRequirements(req.params.id);
    }
    const refreshed = await prisma.clientDeal.findUnique({ where: { id: req.params.id } });
    const dealRow = refreshed ?? row;
    res.json({
        ...mapClientDeal(dealRow, {
            requirementCount: requirements.length,
            furthestRequirementStage: furthest?.businessStage,
            furthestRequirementPercentage: furthest?.stagePercentage,
        }),
        requirements: requirements.map(mapBusinessRequirement),
    });
});
router.patch('/:id/stage', requireRoles(...BUSINESS_MUTATE_ROLES), async (req, res) => {
    try {
        await assertCanMutateClientDeal(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof BusinessRequirementAccessError) {
            const status = err.message === 'Not found' ? 404 : 403;
            return res.status(status).json({ error: err.message });
        }
        throw err;
    }
    const existing = await prisma.clientDeal.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    if (existing.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'Stage cannot be changed on a cancelled client card' });
    }
    const stage = typeof req.body?.businessStage === 'string' ? req.body.businessStage : '';
    if (!isClientDealStageKey(stage)) {
        return res.status(400).json({ error: 'Invalid client deal stage' });
    }
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (!description) {
        return res.status(400).json({ error: 'Description is required when changing stage' });
    }
    if (description.length > 2000) {
        return res.status(400).json({ error: 'Description must be at most 2000 characters' });
    }
    if (existing.sowGatewayReached) {
        return res.status(400).json({ error: STAGE_ROLLBACK_ERROR });
    }
    const percentage = clientDealStagePercentage(stage);
    if (isBusinessStageRollback(existing.businessStage, stage)) {
        return res.status(400).json({ error: STAGE_ROLLBACK_ERROR });
    }
    const timestamp = new Date().toISOString();
    const history = parseStageHistory(existing.stageHistory);
    history.push({
        stage,
        percentage,
        by: req.auth.userId,
        at: timestamp,
        role: req.auth.role,
        description,
    });
    const row = await prisma.clientDeal.update({
        where: { id: req.params.id },
        data: {
            businessStage: stage,
            stagePercentage: percentage,
            sowGatewayReached: false,
            stageHistory: JSON.stringify(history),
        },
    });
    if (stage !== existing.businessStage) {
        await logActivity({
            entityType: 'CLIENT_DEAL',
            entityId: row.id,
            action: 'STAGE_CHANGED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            timestamp,
            details: { client: row.client, stage, percentage, description },
        });
    }
    res.json(mapClientDeal(row));
});
router.patch('/:id/sow-gateway', requireRoles(...BUSINESS_MUTATE_ROLES), async (req, res) => {
    try {
        await assertCanMutateClientDeal(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof BusinessRequirementAccessError) {
            const status = err.message === 'Not found' ? 404 : 403;
            return res.status(status).json({ error: err.message });
        }
        throw err;
    }
    const existing = await prisma.clientDeal.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    if (existing.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'SOW cannot be selected on a cancelled client card' });
    }
    const requirementCount = await prisma.businessRequirement.count({
        where: { clientDealId: req.params.id },
    });
    if (requirementCount > 0) {
        return res.status(400).json({ error: 'Update requirement stages after the first role exists' });
    }
    if (existing.sowGatewayReached) {
        return res.json(mapClientDeal(existing));
    }
    if (existing.businessStage !== 'NEGOTIATION') {
        return res.status(400).json({
            error: 'Client card must be at Negotiation before selecting SOW',
        });
    }
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (!description) {
        return res.status(400).json({ error: 'Description is required when selecting SOW' });
    }
    if (description.length > 2000) {
        return res.status(400).json({ error: 'Description must be at most 2000 characters' });
    }
    const sowStage = 'SOW';
    const sowPercentage = businessStagePercentage(sowStage);
    const timestamp = new Date().toISOString();
    const history = parseStageHistory(existing.stageHistory);
    history.push({
        stage: sowStage,
        percentage: sowPercentage,
        by: req.auth.userId,
        at: timestamp,
        role: req.auth.role,
        description,
    });
    const row = await prisma.clientDeal.update({
        where: { id: req.params.id },
        data: {
            sowGatewayReached: true,
            stageHistory: JSON.stringify(history),
        },
    });
    await logActivity({
        entityType: 'CLIENT_DEAL',
        entityId: row.id,
        action: 'STAGE_CHANGED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        timestamp,
        details: { client: row.client, stage: sowStage, percentage: sowPercentage, description },
    });
    res.json(mapClientDeal(row));
});
router.patch('/:id/sow-signed', requireRoles(...BUSINESS_MUTATE_ROLES), async (req, res) => {
    try {
        await assertCanMutateClientDeal(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof BusinessRequirementAccessError) {
            const status = err.message === 'Not found' ? 404 : 403;
            return res.status(status).json({ error: err.message });
        }
        throw err;
    }
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (!description) {
        return res.status(400).json({ error: 'Description is required when signing SOW' });
    }
    if (description.length > 2000) {
        return res.status(400).json({ error: 'Description must be at most 2000 characters' });
    }
    try {
        const { deal } = await confirmLinkedRequirementsOnSowSigned(req.params.id, description, {
            userId: req.auth.userId,
            role: req.auth.role,
        });
        const requirements = await prisma.businessRequirement.findMany({
            where: { clientDealId: req.params.id },
            orderBy: { createdAt: 'desc' },
        });
        const furthest = requirements.reduce((best, req) => !best || req.stagePercentage > best.stagePercentage
            ? { businessStage: req.businessStage, stagePercentage: req.stagePercentage }
            : best, null);
        res.json({
            ...mapClientDeal(deal, {
                requirementCount: requirements.length,
                furthestRequirementStage: furthest?.businessStage,
                furthestRequirementPercentage: furthest?.stagePercentage,
            }),
            requirements: requirements.map(mapBusinessRequirement),
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Could not sign SOW';
        const status = message === 'Not found' ? 404 : 400;
        return res.status(status).json({ error: message });
    }
});
router.post('/:id/cancel', requireRoles(...BUSINESS_MUTATE_ROLES), async (req, res) => {
    try {
        await assertCanMutateClientDeal(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof BusinessRequirementAccessError) {
            const status = err.message === 'Not found' ? 404 : 403;
            return res.status(status).json({ error: err.message });
        }
        throw err;
    }
    const existing = await prisma.clientDeal.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    if (existing.status === 'CANCELLED') {
        return res.status(400).json({ error: 'Already cancelled' });
    }
    const row = await prisma.clientDeal.update({
        where: { id: req.params.id },
        data: { status: 'CANCELLED' },
    });
    await logActivity({
        entityType: 'CLIENT_DEAL',
        entityId: row.id,
        action: 'CANCELLED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { client: row.client },
    });
    res.json(mapClientDeal(row));
});
export default router;
