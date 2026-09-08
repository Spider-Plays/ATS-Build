import { Router } from 'express';
import { z } from 'zod';
import { requireActiveUser, requireAuth, requireRoles } from '../middleware/auth.js';
import { DEFAULT_FEATURE_FLAGS, FEATURE_FLAG_KEYS, getFeatureFlags, saveFeatureFlags } from '../lib/featureFlags.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
router.get('/', async (_req, res) => {
    res.json({ flags: await getFeatureFlags(), keys: FEATURE_FLAG_KEYS });
});
router.put('/', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const flags = z.record(z.boolean()).parse(req.body.flags);
    const saved = await saveFeatureFlags(flags, req.auth.userId);
    res.json({ flags: saved, keys: FEATURE_FLAG_KEYS });
});
router.post('/reset', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const saved = await saveFeatureFlags(DEFAULT_FEATURE_FLAGS, req.auth.userId);
    res.json({ flags: saved, keys: FEATURE_FLAG_KEYS });
});
export default router;
