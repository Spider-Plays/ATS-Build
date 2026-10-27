import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireActiveUser, requireRoles, requireExactRoles } from '../middleware/auth.js';
import { RETENTION_GROUPS, RETENTION_GROUP_LABELS, getPrivacySettings, getRetentionBounds, savePrivacySettings, } from '../lib/privacySettings.js';
import { getLastRetentionRun, getRetentionHistory, isRetentionRunning, runDataRetention, } from '../lib/dataRetention.js';
import { logActivity } from '../services/activityLog.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
const READ_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_HEAD'];
async function overview() {
    const [settings, lastRun] = await Promise.all([getPrivacySettings(), getLastRetentionRun()]);
    return {
        settings,
        bounds: getRetentionBounds(),
        groups: RETENTION_GROUPS.map((key) => ({ key, ...RETENTION_GROUP_LABELS[key] })),
        lastRun,
        running: isRetentionRunning(),
    };
}
router.get('/', requireRoles(...READ_ROLES), async (_req, res) => {
    res.json(await overview());
});
router.get('/history', requireRoles(...READ_ROLES), async (_req, res) => {
    res.json({ runs: await getRetentionHistory() });
});
function settingsSchema() {
    const { minDays, maxDays, maxBatchSize } = getRetentionBounds();
    const days = z.number().int().min(minDays).max(maxDays);
    return z.object({
        mode: z.enum(['off', 'dry_run', 'live']),
        action: z.enum(['anonymize', 'delete']),
        periodDays: z.object(Object.fromEntries(RETENTION_GROUPS.map((g) => [g, days]))),
        hiredRecordDays: days,
        batchSize: z.number().int().min(1).max(maxBatchSize),
        runHourIst: z.number().int().min(0).max(23),
    });
}
/** Developer only. Super Admin is not exempt here. */
router.put('/', requireExactRoles(), async (req, res) => {
    const parsed = settingsSchema().safeParse(req.body);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
        return res.status(400).json({ error: `${issue?.message || 'Invalid retention settings'}${where}` });
    }
    const before = await getPrivacySettings();
    const saved = await savePrivacySettings(parsed.data, req.auth.userId);
    await logActivity({
        entityType: 'SYSTEM',
        entityId: 'data-retention',
        action: 'RETENTION_SETTINGS_CHANGED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { before, after: saved },
    });
    res.json(await overview());
});
const runSchema = z.object({ dryRun: z.boolean().optional() });
/** Developer only. With no body this follows the saved mode. */
router.post('/run', requireExactRoles(), async (req, res) => {
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success)
        return res.status(400).json({ error: 'Invalid request' });
    if (isRetentionRunning())
        return res.status(409).json({ error: 'A retention run is already in progress' });
    const settings = await getPrivacySettings();
    const dryRun = parsed.data.dryRun ?? settings.mode !== 'live';
    if (!dryRun && settings.mode !== 'live') {
        return res.status(400).json({ error: 'Set the mode to Live before running for real' });
    }
    try {
        const result = await runDataRetention(settings, {
            dryRun,
            trigger: 'manual',
            performedBy: req.auth.userId,
        });
        res.json({ result });
    }
    catch (err) {
        console.error('Retention run failed:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Retention run failed' });
    }
});
/** Developer only. Counts what a set of draft settings would affect. Changes nothing, records nothing. */
router.post('/preview', requireExactRoles(), async (req, res) => {
    const parsed = settingsSchema().safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid retention settings' });
    }
    if (isRetentionRunning())
        return res.status(409).json({ error: 'A retention run is already in progress' });
    try {
        const result = await runDataRetention(parsed.data, { dryRun: true, trigger: 'preview' });
        res.json({ result });
    }
    catch (err) {
        console.error('Retention preview failed:', err);
        res.status(500).json({ error: 'Retention preview failed' });
    }
});
export default router;
