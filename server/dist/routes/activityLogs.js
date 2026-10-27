import { Router } from 'express';
import { mapActivityLog } from '../utils/mappers.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { REQUIREMENT_API_ROLES } from '../lib/roles.js';
import { listActivityLogsForAuth, listActivityLogsForEntity, } from '../lib/activityLogAccess.js';
import { CandidateAccessError } from '../lib/candidateAccess.js';
const router = Router();
// Staff only: portal accounts (candidate, vendor, employee) have their own scoped routes.
router.use(requireAuth, requireActiveUser, requireRoles(...REQUIREMENT_API_ROLES));
router.get('/', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const rows = await listActivityLogsForAuth(req.auth, limit);
    res.json(rows.map(mapActivityLog));
});
router.get('/entity/:entityId', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
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
// Audit entries are written server-side only; there is intentionally no POST endpoint.
export default router;
