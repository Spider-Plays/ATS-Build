import { Router } from 'express';
import { z } from 'zod';
import { requireActiveUser, requireAuth } from '../middleware/auth.js';
import { PAGE_KEYS } from '../lib/pageAccess.js';
import { defaultPagePublication, getPagePublication, savePagePublication } from '../lib/pagePublication.js';
import { logActivity } from '../services/activityLog.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
function requireDeveloper(req, res, next) {
    if (req.auth?.role !== 'DEVELOPER') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}
router.get('/', requireDeveloper, async (_req, res) => {
    res.json({ pages: await getPagePublication() });
});
router.put('/', requireDeveloper, async (req, res) => {
    const pages = z.record(z.string(), z.boolean()).parse(req.body.pages);
    const previous = await getPagePublication();
    const saved = await savePagePublication(pages, req.auth.userId);
    const changes = Object.fromEntries(PAGE_KEYS.filter((key) => previous[key] !== saved[key]).map((key) => [key, { from: previous[key], to: saved[key] }]));
    await logActivity({
        entityType: 'PAGE_PUBLICATION',
        entityId: 'page-publication',
        action: 'PAGE_PUBLICATION_UPDATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { changes },
    });
    res.json({ pages: saved });
});
router.post('/reset', requireDeveloper, async (req, res) => {
    const saved = await savePagePublication(defaultPagePublication(), req.auth.userId);
    await logActivity({
        entityType: 'PAGE_PUBLICATION',
        entityId: 'page-publication',
        action: 'PAGE_PUBLICATION_RESET',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {},
    });
    res.json({ pages: saved });
});
export default router;
