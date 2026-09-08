import { Router } from 'express';
import { z } from 'zod';
import { ensureInterviewPanelCatalog, listInterviewPanelLevels, updateInterviewPanelLevel, } from '../lib/interviewPanelCatalog.js';
import { assertPrismaClientModels } from '../lib/prisma.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { INTERNAL_ROLES } from '../lib/roles.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
router.get('/', requireRoles(...INTERNAL_ROLES), async (_req, res) => {
    try {
        assertPrismaClientModels();
        const levels = await listInterviewPanelLevels();
        res.json(levels);
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to load interview panels';
        const status = message.includes('Prisma client is out of date') ? 503 : 500;
        res.status(status).json({ error: message });
    }
});
router.post('/seed', requireRoles('ADMIN'), async (_req, res) => {
    try {
        assertPrismaClientModels();
        await ensureInterviewPanelCatalog();
        const levels = await listInterviewPanelLevels();
        res.json(levels);
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to initialize interview panels';
        const status = message.includes('Prisma client is out of date') ? 503 : 500;
        res.status(status).json({ error: message });
    }
});
router.put('/:id', requireRoles('ADMIN'), async (req, res) => {
    const body = z
        .object({
        interviewerIds: z.array(z.string().min(1)),
    })
        .parse(req.body);
    try {
        const level = await updateInterviewPanelLevel(req.params.id, body.interviewerIds);
        res.json(level);
    }
    catch (e) {
        if (e instanceof Error && e.message === 'Interview panel level not found') {
            return res.status(404).json({ error: e.message });
        }
        throw e;
    }
});
export default router;
