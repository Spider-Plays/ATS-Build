import { Router } from 'express';
import { mapActivityLog } from '../utils/mappers.js';
import { requireAuth, requireActiveUser } from '../middleware/auth.js';
import { listActivityLogsForAuth, listActivityLogsForEntity, } from '../lib/activityLogAccess.js';
import { CandidateAccessError } from '../lib/candidateAccess.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
router.get('/', async (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const rows = await listActivityLogsForAuth(req.auth, limit);
    res.json(rows.map(mapActivityLog));
});
router.get('/entity/:entityId', async (req, res) => {
    const limit = Number(req.query.limit) || 50;
    try {
        const rows = await listActivityLogsForEntity(req.auth, req.params.entityId, limit);
        res.json(rows.map(mapActivityLog));
    }
    catch (e) {
        if (e instanceof CandidateAccessError) {
            return res.status(403).json({ error: e.message });
        }
        throw e;
    }
});
router.post('/', async (req, res) => {
    const body = req.body;
    if (!body.entityType || !body.entityId || !body.action) {
        return res.status(400).json({ error: 'entityType, entityId, and action are required' });
    }
    const { logActivity } = await import('../services/activityLog.js');
    await logActivity({
        entityType: body.entityType,
        entityId: body.entityId,
        action: body.action,
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: body.details,
    });
    res.status(201).json({ ok: true });
});
export default router;
