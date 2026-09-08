import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { requireIntegrationApiKey } from './auth.js';
import { getM365ConfigStatus, getM365SetupGuide, sendM365HtmlEmail, testM365Connection, } from './client.js';
const router = Router();
router.use(requireIntegrationApiKey);
router.get('/setup-guide', (_req, res) => {
    res.json(getM365SetupGuide());
});
router.get('/status', async (_req, res) => {
    const config = getM365ConfigStatus();
    const connection = config.configured ? await testM365Connection() : { ok: false, message: 'Not configured' };
    res.json({
        ...config,
        connection,
        activeProvider: config.configured ? 'microsoft365' : env.resendApiKey ? 'resend' : null,
    });
});
router.post('/test-connection', async (_req, res) => {
    const result = await testM365Connection();
    if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.message });
    }
    res.json({ ok: true, message: 'Microsoft 365 connection successful' });
});
const testEmailSchema = z.object({
    to: z.string().email(),
    subject: z.string().min(1).max(200).optional(),
});
router.post('/test-email', async (req, res) => {
    const parsed = testEmailSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const subject = parsed.data.subject ?? `${env.appName} — Microsoft 365 test email`;
    const result = await sendM365HtmlEmail({
        to: parsed.data.to,
        subject,
        html: `
      <div style="font-family: Inter, system-ui, sans-serif; max-width: 520px; margin: 0 auto; color: #1a2b3c;">
        <h1 style="font-size: 22px;">Microsoft 365 connected</h1>
        <p>This is a test message from <strong>${env.appName}</strong>.</p>
        <p>If you received this email, your Azure app registration and sender mailbox are configured correctly.</p>
      </div>
    `,
    });
    if (!result.sent) {
        const status = result.reason === 'not_configured' ? 503 : 400;
        return res.status(status).json({
            ok: false,
            error: result.reason === 'error' ? result.message : 'Microsoft 365 email is not configured',
        });
    }
    res.json({ ok: true, messageId: result.id, to: parsed.data.to });
});
export default router;
