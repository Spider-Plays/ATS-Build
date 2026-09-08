import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { getPrivacySettings, savePrivacySettings } from '../lib/privacySettings.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
router.get('/', requireRoles('SUPER_ADMIN', 'ADMIN', 'HR_HEAD'), async (_req, res) => {
    res.json(await getPrivacySettings());
});
const patchSchema = z.object({
    unsuccessfulRetentionDays: z.number().int().min(30).max(3650),
    hiredRetentionDays: z.number().int().min(30).max(3650),
});
router.put('/', requireRoles('SUPER_ADMIN', 'ADMIN', 'HR_HEAD'), async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid privacy settings' });
    }
    res.json(await savePrivacySettings(parsed.data, req.auth.userId));
});
export default router;
