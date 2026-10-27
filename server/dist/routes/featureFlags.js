import { Router } from 'express';
import { z } from 'zod';
import { requireActiveUser, requireAuth, requireRoles } from '../middleware/auth.js';
import { DEFAULT_FEATURE_FLAGS, FEATURE_FLAG_KEYS, getFeatureFlags, saveFeatureFlags } from '../lib/featureFlags.js';
import { logActivity } from '../services/activityLog.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
router.get('/', async (_req, res) => {
    res.json({ flags: await getFeatureFlags(), keys: FEATURE_FLAG_KEYS });
});
router.put('/', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const flags = z.record(z.boolean()).parse(req.body.flags);
    const previous = await getFeatureFlags();
    const saved = await saveFeatureFlags(flags, req.auth.userId);
    const changes = Object.fromEntries(FEATURE_FLAG_KEYS
        .filter((key) => previous[key] !== saved[key])
        .map((key) => [key, { from: previous[key], to: saved[key] }]));
    await logActivity({
        entityType: 'FEATURE_VISIBILITY',
        entityId: 'feature-flags',
        action: 'FEATURE_VISIBILITY_UPDATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { changes },
    });
    res.json({ flags: saved, keys: FEATURE_FLAG_KEYS });
});
router.post('/reset', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const previous = await getFeatureFlags();
    const saved = await saveFeatureFlags(DEFAULT_FEATURE_FLAGS, req.auth.userId);
    const changes = Object.fromEntries(FEATURE_FLAG_KEYS
        .filter((key) => previous[key] !== saved[key])
        .map((key) => [key, { from: previous[key], to: saved[key] }]));
    await logActivity({
        entityType: 'FEATURE_VISIBILITY',
        entityId: 'feature-flags',
        action: 'FEATURE_VISIBILITY_RESET',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { changes },
    });
    res.json({ flags: saved, keys: FEATURE_FLAG_KEYS });
});
export default router;
