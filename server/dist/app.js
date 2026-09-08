import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import { Prisma } from '@prisma/client';
import { env } from './config/env.js';
import { resolveApiBuildId } from './config/buildId.js';
import { prisma } from './lib/prisma.js';
import { isEmailConfigured } from './services/email.js';
import { databaseHostLabel } from './config/loadEnv.js';
import { isProductionNeonDatabaseUrl, isStagingRuntime } from './config/databaseEnv.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import businessRequirementRoutes from './routes/businessRequirements.js';
import clientDealRoutes from './routes/clientDeals.js';
import requirementRoutes from './routes/requirements.js';
import candidateRoutes from './routes/candidates.js';
import interviewRoutes from './routes/interviews.js';
import offerRoutes from './routes/offers.js';
import feedbackRoutes from './routes/feedback.js';
import activityLogRoutes from './routes/activityLogs.js';
import searchRoutes from './routes/search.js';
import portalRoutes from './routes/portal.js';
import careersRoutes from './routes/careers.js';
import vendorRoutes from './routes/vendors.js';
import vendorOnboardingRoutes from './routes/vendorOnboarding.js';
import vendorPortalRoutes from './routes/vendorPortal.js';
import referralPortalRoutes from './routes/referralPortal.js';
import skillRoutes from './routes/skills.js';
import departmentRoutes from './routes/departments.js';
import clientRoutes from './routes/clients.js';
import cityRoutes from './routes/cities.js';
import dropdownCatalogRoutes from './routes/dropdownCatalogs.js';
import roleAccessRoutes from './routes/roleAccess.js';
import interviewPanelRoutes from './routes/interviewPanels.js';
import offerSettingsRoutes from './routes/offerSettings.js';
import { m365Routes } from './integrations/m365/index.js';
import changeRequestRoutes from './routes/changeRequests.js';
import assistantRoutes from './routes/assistant.js';
import reportRoutes from './routes/reports.js';
import marketTrendsRoutes from './routes/marketTrends.js';
import notificationRoutes from './routes/notifications.js';
import privacyRoutes from './routes/privacy.js';
export const app = express();
// Render (and Cloudflare) sit behind a reverse proxy — required for rate limiting and client IP.
if (process.env.RENDER === 'true' || env.isProduction) {
    app.set('trust proxy', 1);
}
const devOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:3003',
    'http://127.0.0.1:3003',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
];
function isAllowedOrigin(origin) {
    const normalized = origin.replace(/\/$/, '');
    if (devOrigins.includes(normalized) || env.clientOrigins.includes(normalized))
        return true;
    if (!env.isProduction)
        return false;
    return (/^https:\/\/(www\.)?stitch-ats\.in$/.test(normalized) ||
        /^https:\/\/[\w-]+\.stitch-ats\.in$/.test(normalized) ||
        /^https:\/\/([\w-]+\.)*[\w-]+\.pages\.dev$/.test(normalized) ||
        /^https:\/\/ats\.[\w-]+\.workers\.dev$/.test(normalized));
}
app.use(cors({
    origin(origin, callback) {
        if (!origin)
            return callback(null, true);
        if (isAllowedOrigin(origin))
            return callback(null, true);
        callback(null, false);
    },
    credentials: true,
}));
app.use(express.json());
app.get('/', (_req, res) => {
    res.json({
        service: 'Stitch ATS',
        health: '/api/health',
        hint: 'Open your Cloudflare Pages site for the app UI — this URL is the API only.',
    });
});
app.get('/api/health', async (_req, res) => {
    const buildId = resolveApiBuildId();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
        await prisma.$queryRaw `SELECT 1`;
        const databaseHost = databaseHostLabel();
        res.json({
            ok: true,
            database: 'connected',
            buildId,
            email: isEmailConfigured() ? 'configured' : 'not_configured',
            atsEnv: process.env.ATS_ENV === 'local'
                ? 'local'
                : process.env.ATS_ENV === 'igs'
                    ? 'igs'
                    : isStagingRuntime()
                        ? 'staging'
                        : 'production',
            databaseHost,
            databaseTier: databaseHost
                ? isProductionNeonDatabaseUrl(process.env.DATABASE_URL)
                    ? 'production-neon'
                    : 'non-production-neon'
                : undefined,
        });
    }
    catch {
        res.status(503).json({
            ok: false,
            database: 'unavailable',
            buildId,
            email: isEmailConfigured() ? 'configured' : 'not_configured',
        });
    }
});
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/business-requirements', businessRequirementRoutes);
app.use('/api/client-deals', clientDealRoutes);
app.use('/api/requirements', requirementRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/careers', careersRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/vendor-onboarding', vendorOnboardingRoutes);
app.use('/api/vendor-portal', vendorPortalRoutes);
app.use('/api/referral-portal', referralPortalRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/cities', cityRoutes);
app.use('/api/dropdown-catalogs', dropdownCatalogRoutes);
app.use('/api/role-access', roleAccessRoutes);
app.use('/api/interview-panels', interviewPanelRoutes);
app.use('/api/offer-settings', offerSettingsRoutes);
app.use('/api/integrations/m365', m365Routes);
app.use('/api/change-requests', changeRequestRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/market-trends', marketTrendsRoutes);
app.use('/api/privacy', privacyRoutes);
app.use('/api/notifications', notificationRoutes);
app.use((err, _req, res, _next) => {
    console.error(err);
    const prismaConnCodes = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1011', 'P1017']);
    if (err instanceof Prisma.PrismaClientInitializationError ||
        (err instanceof Prisma.PrismaClientKnownRequestError &&
            prismaConnCodes.has(err.code))) {
        return res.status(503).json({
            error: env.isProduction
                ? 'Database unavailable.'
                : 'Database unavailable. Wake your Neon project in the console or check DATABASE_URL in server/.env.',
        });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021') {
        return res.status(503).json({
            error: env.isProduction
                ? 'Database schema is out of date.'
                : `Database table missing (${err.meta?.table ?? 'unknown'}). Run \`npm run db:push --prefix server\` against your DATABASE_URL, then restart the API.`,
        });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2022') {
        return res.status(503).json({
            error: env.isProduction
                ? 'Database schema is out of date.'
                : `Database column mismatch (${String(err.meta?.column ?? 'unknown')}). Stop the API, run \`npm run db:generate --prefix server\`, then restart \`npm run dev\`.`,
        });
    }
    if (err && typeof err === 'object' && 'code' in err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large (max 5 MB)' });
    }
    if (err instanceof Error && err.message.includes('Only PDF')) {
        return res.status(400).json({ error: err.message });
    }
    if (err instanceof Error && err.name === 'RequirementFieldError') {
        return res.status(400).json({ error: err.message });
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
        const msg = err.message;
        if (msg.includes('hiringStage') ||
            msg.includes('onHoldAt') ||
            msg.includes('liveAt') ||
            msg.includes('mustChangePassword')) {
            return res.status(503).json({
                error: env.isProduction
                    ? 'Server configuration is out of date.'
                    : 'Server Prisma client is out of date. Stop the API, run `npm run db:generate --prefix server`, then restart `npm run dev`.',
            });
        }
    }
    if (err instanceof TypeError &&
        (err.message.includes('findUnique') ||
            err.message.includes("'count'") ||
            err.message.includes("'create'"))) {
        const stack = err.stack ?? '';
        if (stack.includes('ensureInterviewPlan') ||
            stack.includes('clientCatalog') ||
            stack.includes('ensureDefaultClientCatalog') ||
            stack.includes('interviewPanelCatalog') ||
            stack.includes('interviewPanelLevel')) {
            return res.status(503).json({
                error: env.isProduction
                    ? 'Server configuration is out of date.'
                    : 'Server Prisma client is out of date. Stop the API, run `npm run db:generate --prefix server`, then restart `npm run dev`.',
            });
        }
    }
    if (err && typeof err === 'object' && 'issues' in err) {
        return res.status(400).json({ error: 'Validation failed' });
    }
    res.status(500).json({ error: 'Internal server error' });
});
