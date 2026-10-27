import crypto from 'node:crypto';
import { m365Config } from './config.js';
export function requireIntegrationApiKey(req, res, next) {
    if (!m365Config.integrationApiKey) {
        return res.status(503).json({
            error: 'Integration API is not configured. Set M365_INTEGRATION_API_KEY on the server.',
        });
    }
    const headerKey = req.headers['x-integration-api-key'];
    const provided = typeof headerKey === 'string' ? headerKey.trim() : '';
    const expected = Buffer.from(m365Config.integrationApiKey);
    const given = Buffer.from(provided);
    if (!provided || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
        return res.status(401).json({ error: 'Invalid or missing integration API key' });
    }
    next();
}
