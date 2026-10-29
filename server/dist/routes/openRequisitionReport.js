import { Router } from 'express';
import { z, ZodError } from 'zod';
import { requireActiveUser, requireAuth, requireRoles } from '../middleware/auth.js';
import { getOpenRequisitionReportRecipients, saveOpenRequisitionReportRecipients, } from '../lib/openRequisitionReportRecipients.js';
import { runOpenRequisitionReport } from '../lib/emailDispatch.js';
import { logActivity } from '../services/activityLog.js';
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles('ADMIN'));
const bodySchema = z.object({
    to: z.array(z.string()).default([]),
    cc: z.array(z.string()).default([]),
    bcc: z.array(z.string()).default([]),
});
router.get('/recipients', async (_req, res) => {
    res.json(await getOpenRequisitionReportRecipients());
});
router.put('/recipients', async (req, res) => {
    try {
        const body = bodySchema.parse(req.body);
        const recipients = await saveOpenRequisitionReportRecipients(body, req.auth.userId);
        await logActivity({
            entityType: 'APP_SETTING',
            entityId: 'open-requisition-report',
            action: 'OPEN_REQUISITION_REPORT_RECIPIENTS_UPDATED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: recipients,
        });
        res.json(recipients);
    }
    catch (error) {
        if (error instanceof ZodError) {
            return res.status(400).json({ error: 'Enter valid email addresses' });
        }
        const message = error instanceof Error ? error.message : 'Could not save recipients';
        if (message === 'Choose at least one To recipient') {
            return res.status(400).json({ error: message });
        }
        throw error;
    }
});
router.post('/send', async (req, res) => {
    const result = await runOpenRequisitionReport(new Date(), { force: true });
    if (!result.sent) {
        return res.status(400).json({ error: result.reason || 'Could not send report', ...result });
    }
    await logActivity({
        entityType: 'APP_SETTING',
        entityId: 'open-requisition-report',
        action: 'OPEN_REQUISITION_REPORT_SENT',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { active: result.active ?? 0 },
    });
    res.json(result);
});
export default router;
