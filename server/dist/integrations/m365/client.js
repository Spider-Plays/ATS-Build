import { env } from '../../config/env.js';
import { m365Config } from './config.js';
let cachedToken = null;
export function isM365EmailConfigured() {
    return Boolean(m365Config.tenantId &&
        m365Config.clientId &&
        m365Config.clientSecret &&
        m365Config.senderEmail);
}
export function getM365ConfigStatus() {
    return {
        provider: 'microsoft365',
        configured: isM365EmailConfigured(),
        senderEmail: m365Config.senderEmail || null,
        tenantId: m365Config.tenantId ? maskSecret(m365Config.tenantId) : null,
        clientId: m365Config.clientId ? maskSecret(m365Config.clientId) : null,
        hasClientSecret: Boolean(m365Config.clientSecret),
        displayName: m365Config.senderDisplayName || env.appName,
    };
}
function maskSecret(value) {
    if (value.length <= 8)
        return '****';
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
export async function getGraphAccessToken() {
    if (!isM365EmailConfigured()) {
        throw new Error('Microsoft 365 email is not configured');
    }
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAt > now + 60_000) {
        return cachedToken.value;
    }
    const tokenUrl = `https://login.microsoftonline.com/${m365Config.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id: m365Config.clientId,
        client_secret: m365Config.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });
    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const payload = (await response.json());
    if (!response.ok || !payload.access_token) {
        const detail = payload.error_description || payload.error || `HTTP ${response.status}`;
        throw new Error(`Microsoft 365 authentication failed: ${detail}`);
    }
    cachedToken = {
        value: payload.access_token,
        expiresAt: now + payload.expires_in * 1000,
    };
    return payload.access_token;
}
export async function testM365Connection() {
    if (!isM365EmailConfigured()) {
        return { ok: false, message: 'Microsoft 365 email is not configured' };
    }
    try {
        const token = await getGraphAccessToken();
        const userUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(m365Config.senderEmail)}?$select=displayName,mail,userPrincipalName`;
        const response = await fetch(userUrl, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
            const text = await response.text();
            return {
                ok: false,
                message: `Mailbox lookup failed (${response.status}): ${text.slice(0, 240)}`,
            };
        }
        return { ok: true };
    }
    catch (e) {
        return {
            ok: false,
            message: e instanceof Error ? e.message : 'Connection test failed',
        };
    }
}
export async function sendM365HtmlEmail(params) {
    if (!isM365EmailConfigured())
        return { sent: false, reason: 'not_configured' };
    const recipients = Array.isArray(params.to) ? params.to : [params.to];
    const message = {
        subject: params.subject,
        body: {
            contentType: 'HTML',
            content: params.html,
        },
        toRecipients: recipients.map((address) => ({
            emailAddress: { address },
        })),
        ...(params.cc?.length
            ? { ccRecipients: params.cc.map((address) => ({ emailAddress: { address } })) }
            : {}),
        ...(params.bcc?.length
            ? { bccRecipients: params.bcc.map((address) => ({ emailAddress: { address } })) }
            : {}),
        ...(params.replyTo ? { replyTo: [{ emailAddress: { address: params.replyTo } }] } : {}),
        ...(params.inlineAttachments?.length || params.attachments?.length
            ? {
                attachments: [
                    ...(params.inlineAttachments?.map((item) => ({
                        '@odata.type': '#microsoft.graph.fileAttachment',
                        name: item.filename,
                        contentType: item.contentType,
                        contentBytes: item.content.toString('base64'),
                        contentId: item.cid,
                        isInline: true,
                    })) ?? []),
                    ...(params.attachments?.map((item) => ({
                        '@odata.type': '#microsoft.graph.fileAttachment',
                        name: item.filename,
                        contentType: item.contentType,
                        contentBytes: item.content.toString('base64'),
                        isInline: false,
                    })) ?? []),
                ],
            }
            : {}),
    };
    try {
        const token = await getGraphAccessToken();
        const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(m365Config.senderEmail)}/sendMail`;
        const response = await fetch(sendUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message, saveToSentItems: true }),
        });
        if (!response.ok) {
            const text = await response.text();
            return {
                sent: false,
                reason: 'error',
                message: `Graph sendMail failed (${response.status}): ${text.slice(0, 320)}`,
            };
        }
        return { sent: true, id: `m365-${Date.now()}` };
    }
    catch (e) {
        return {
            sent: false,
            reason: 'error',
            message: e instanceof Error ? e.message : 'Failed to send email via Microsoft 365',
        };
    }
}
export function getM365SetupGuide() {
    return {
        title: 'Microsoft 365 email integration for Stitch ATS',
        summary: 'Register an Azure AD application with application permission Mail.Send, grant admin consent, then set the server environment variables below.',
        azureSteps: [
            'Sign in to Microsoft Entra admin center → App registrations → New registration.',
            'Name the app (e.g. "Stitch ATS Email") and register it. Note the Application (client) ID and Directory (tenant) ID.',
            'Certificates & secrets → New client secret → copy the secret value (shown once).',
            'API permissions → Add permission → Microsoft Graph → Application permissions → Mail.Send and Calendars.ReadWrite → Add permissions.',
            'Click "Grant admin consent" for your organization.',
            'Ensure the sender mailbox exists (e.g. ats@yourcompany.com) and is licensed for Exchange Online.',
        ],
        requiredEnvVars: [
            { name: 'M365_TENANT_ID', description: 'Azure AD directory (tenant) ID' },
            { name: 'M365_CLIENT_ID', description: 'Application (client) ID from app registration' },
            { name: 'M365_CLIENT_SECRET', description: 'Client secret value from Certificates & secrets' },
            { name: 'M365_SENDER_EMAIL', description: 'Office 365 mailbox used as the From address' },
            { name: 'M365_SENDER_DISPLAY_NAME', description: 'Optional display name (defaults to APP_NAME)' },
            { name: 'M365_INTEGRATION_API_KEY', description: 'Shared secret for IT integration API calls' },
            { name: 'M365_CALENDAR_ENABLED', description: 'Set to false to disable Outlook calendar blocking (default: true when M365 is configured)' },
            { name: 'M365_AUTO_TEAMS_MEETING', description: 'Auto-create a Teams link when no meeting URL is provided (default: true)' },
            { name: 'M365_CALENDAR_ORGANIZER_EMAIL', description: 'Mailbox that owns interview calendar events (defaults to M365_SENDER_EMAIL)' },
            { name: 'M365_CALENDAR_TIMEZONE', description: 'IANA timezone for calendar events, e.g. Asia/Kolkata (default: UTC)' },
        ],
        apiBasePath: '/api/integrations/m365',
        authHeader: 'X-Integration-Api-Key',
        endpoints: [
            { method: 'GET', path: '/setup-guide', description: 'This setup guide (requires integration API key)' },
            { method: 'GET', path: '/status', description: 'Configuration and connection status' },
            { method: 'POST', path: '/test-connection', description: 'Validate Azure credentials and mailbox access' },
            { method: 'POST', path: '/test-email', description: 'Send a test HTML email', body: { to: 'recipient@company.com' } },
        ],
        notes: [
            'Mail.Send is an application permission — the app sends as the mailbox in M365_SENDER_EMAIL without per-user sign-in.',
            'After updating env vars, restart the API server.',
            'When M365 is configured, Stitch ATS uses it for all transactional emails instead of Resend.',
            'Interview scheduling creates Outlook calendar events (with optional Teams meetings) and emails include .ics invites for Google Calendar and other clients.',
        ],
    };
}
