import { Router } from 'express';
import { z } from 'zod';
import { requireActiveUser, requireAuth } from '../middleware/auth.js';
import { DEFAULT_EMAIL_COPY, EMAIL_COPY_PLACEHOLDERS, getEmailCopies, saveEmailCopies, } from '../lib/emailCopy.js';
import { DEFAULT_EMAIL_TOGGLES, EMAIL_TOGGLE_KEYS, EMAIL_TOGGLE_LABELS, getEmailToggles, saveEmailToggles, } from '../lib/emailToggles.js';
import { getReportMailControls, saveReportMailControls } from '../lib/reportMail.js';
import { DEFAULT_WORKFLOW_TEMPLATES, WORKFLOW_MAIL_KEYS, WORKFLOW_MAIL_LABELS, WORKFLOW_SLOT_LABELS, WORKFLOW_SLOTS, getWorkflowTemplates, renderWorkflowPreview, saveWorkflowTemplates, } from '../lib/workflowMail.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
function requireDeveloper(req, res, next) {
    if (req.auth?.role !== 'DEVELOPER') {
        res.status(403).json({ error: 'Only Developer can change email delivery' });
        return;
    }
    next();
}
router.get('/', requireDeveloper, async (_req, res) => {
    res.json({
        toggles: await getEmailToggles(),
        keys: EMAIL_TOGGLE_KEYS,
        labels: EMAIL_TOGGLE_LABELS,
    });
});
router.put('/', requireDeveloper, async (req, res) => {
    const toggles = z.record(z.string(), z.boolean()).parse(req.body.toggles);
    const saved = await saveEmailToggles(toggles, req.auth.userId);
    res.json({ toggles: saved, keys: EMAIL_TOGGLE_KEYS, labels: EMAIL_TOGGLE_LABELS });
});
router.post('/reset', requireDeveloper, async (req, res) => {
    const saved = await saveEmailToggles(DEFAULT_EMAIL_TOGGLES, req.auth.userId);
    res.json({ toggles: saved, keys: EMAIL_TOGGLE_KEYS, labels: EMAIL_TOGGLE_LABELS });
});
router.get('/copy', requireDeveloper, async (_req, res) => {
    res.json({
        copies: await getEmailCopies(),
        placeholders: EMAIL_COPY_PLACEHOLDERS,
    });
});
router.put('/copy', requireDeveloper, async (req, res) => {
    const copies = z
        .record(z.string(), z.object({
        subject: z.string().max(300),
        body: z.string().max(8000),
        to: z.array(z.string()).max(20).default([]),
        cc: z.array(z.string()).max(20).default([]),
        bcc: z.array(z.string()).max(20).default([]),
        extraTo: z.array(z.string().email()).max(20).default([]),
        extraCc: z.array(z.string().email()).max(20).default([]),
        extraBcc: z.array(z.string().email()).max(20).default([]),
    }))
        .parse(req.body.copies);
    const saved = await saveEmailCopies(copies, req.auth.userId);
    res.json({ copies: saved, placeholders: EMAIL_COPY_PLACEHOLDERS });
});
router.post('/copy/reset', requireDeveloper, async (req, res) => {
    const cleared = Object.fromEntries(EMAIL_TOGGLE_KEYS.map((key) => [key, { ...DEFAULT_EMAIL_COPY[key], to: [], cc: [], bcc: [], extraTo: [], extraCc: [], extraBcc: [] }]));
    const saved = await saveEmailCopies(cleared, req.auth.userId);
    res.json({ copies: saved, placeholders: EMAIL_COPY_PLACEHOLDERS });
});
router.get('/workflow', requireDeveloper, async (_req, res) => {
    res.json({
        templates: await getWorkflowTemplates(),
        keys: WORKFLOW_MAIL_KEYS,
        labels: WORKFLOW_MAIL_LABELS,
        slots: WORKFLOW_SLOTS,
        slotLabels: WORKFLOW_SLOT_LABELS,
    });
});
router.put('/workflow', requireDeveloper, async (req, res) => {
    const templates = (req.body?.templates ?? {});
    const saved = await saveWorkflowTemplates(templates, req.auth.userId);
    res.json({ templates: saved, keys: WORKFLOW_MAIL_KEYS, labels: WORKFLOW_MAIL_LABELS });
});
router.post('/workflow/reset', requireDeveloper, async (req, res) => {
    const saved = await saveWorkflowTemplates(DEFAULT_WORKFLOW_TEMPLATES, req.auth.userId);
    res.json({ templates: saved });
});
router.get('/reports', requireDeveloper, async (_req, res) => {
    res.json(await getReportMailControls());
});
router.put('/reports', requireDeveloper, async (req, res) => {
    const body = req.body;
    const saved = await saveReportMailControls({
        openRequisitionSubject: String(body?.openRequisitionSubject ?? ''),
        aging: {
            extraTo: body?.aging?.extraTo ?? [],
            cc: body?.aging?.cc ?? [],
            bcc: body?.aging?.bcc ?? [],
            subject: String(body?.aging?.subject ?? ''),
        },
    }, req.auth.userId);
    res.json(saved);
});
router.post('/workflow/preview', requireDeveloper, async (req, res) => {
    const key = req.body?.key;
    if (!WORKFLOW_MAIL_KEYS.includes(key))
        return res.status(400).json({ error: 'Unknown mail' });
    const templates = await getWorkflowTemplates();
    const override = (req.body?.template ?? {});
    const tpl = { ...templates[key], ...override };
    res.json(renderWorkflowPreview(key, tpl));
});
export default router;
