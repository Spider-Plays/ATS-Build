export const m365Config = {
    tenantId: process.env.M365_TENANT_ID?.trim() || '',
    clientId: process.env.M365_CLIENT_ID?.trim() || '',
    clientSecret: process.env.M365_CLIENT_SECRET?.trim() || '',
    senderEmail: process.env.M365_SENDER_EMAIL?.trim() || '',
    senderDisplayName: process.env.M365_SENDER_DISPLAY_NAME?.trim() || '',
    integrationApiKey: process.env.M365_INTEGRATION_API_KEY?.trim() || '',
};
