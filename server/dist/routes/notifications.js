import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireActiveUser } from '../middleware/auth.js';
import { getNotificationReadIds, markNotificationReadIds, } from '../lib/notificationReadIds.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
const markSchema = z.object({
    ids: z.array(z.string().min(1)).max(1000),
});
router.get('/read-ids', async (req, res) => {
    const ids = await getNotificationReadIds(req.auth.userId);
    res.json({ ids });
});
router.post('/read-ids/mark', async (req, res) => {
    const parsed = markSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid notification ids' });
    }
    const ids = await markNotificationReadIds(req.auth.userId, parsed.data.ids);
    res.json({ ids });
});
export default router;
