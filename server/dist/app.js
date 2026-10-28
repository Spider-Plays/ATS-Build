import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import { Prisma } from '@prisma/client';
import { env } from './config/env.js';
import { resolveApiBuildId } from './config/buildId.js';
import { prisma } from './lib/prisma.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import businessRequirementRoutes from './routes/businessRequirements.js';
import clientDealRoutes from './routes/clientDeals.js';
import requirementRoutes from './routes/requirements.js';
import candidateRoutes from './routes/candidates.js';
import interviewRoutes from './routes/interviews.js';
import interviewRsvpRoutes from './routes/interviewRsvp.js';
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
import referralReviewRoutes from './routes/referralReview.js';
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
import featureFlagsRoutes from './routes/featureFlags.js';
import emailToggleRoutes from './routes/emailToggles.js';
import databaseBackupRoutes from './routes/databaseBackups.js';
import pagePublicationRoutes from './routes/pagePublication.js';
import openRequisitionReportRoutes from './routes/openRequisitionReport.js';
import { appLogMiddleware } from './lib/appLog.js';
export const app = express();
// The reverse proxy (nginx on this host, or the local Vite proxy) connects over loopback and sets
// X-Forwarded-For. Trust that header only from a loopback peer: if the API is ever reached
// directly, a client-sent X-Forwarded-For is ignored and cannot reset per-IP rate limits.
app.set('trust proxy', 'loopback');
app.use(helmet({
    // The SPA is served by the frontend host; the API only returns JSON and files.
    contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    // Match frame-ancestors 'none' for browsers that only read X-Frame-Options.
    frameguard: { action: 'deny' },
}));
const PRODUCTION_ORIGINS = ['https://ats.igsglobal.co'];
// Local development origins are never trusted in production.
const devOrigins = env.isProduction ? PRODUCTION_ORIGINS : [
    ...PRODUCTION_ORIGINS,
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
    // Production only trusts HTTPS origins, even if CLIENT_ORIGIN lists a localhost/dev address.
    if (env.isProduction && !normalized.startsWith('https://'))
        return false;
    const appOrigin = env.clientOrigin.replace(/\/$/, '');
    if (normalized === appOrigin)
        return true;
    if (devOrigins.includes(normalized) || env.clientOrigins.includes(normalized))
        return true;
    return false;
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
app.use(express.json({ limit: '1mb' }));
// API responses carry personal data; never let browsers or proxies keep them. Routes may override.
app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});
app.use(appLogMiddleware);
app.get('/', (_req, res) => {
    res.json({
        service: 'Stitch ATS',
        health: '/api/health',
        hint: `Open the app at ${env.clientOrigin}.`,
    });
});
// Public, so it says only whether the API is up. buildId is an opaque build hash the SPA
// compares to detect a new deploy (src/lib/deploySync.ts); it reveals no configuration.
app.get('/api/health', async (_req, res) => {
    const buildId = resolveApiBuildId();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    try {
        await prisma.$queryRaw `SELECT 1`;
        res.json({ ok: true, buildId });
    }
    catch {
        res.status(503).json({ ok: false, buildId });
    }
});
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/business-requirements', businessRequirementRoutes);
app.use('/api/client-deals', clientDealRoutes);
app.use('/api/requirements', requirementRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/interview-rsvp', interviewRsvpRoutes);
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
app.use('/api/referral-review', referralReviewRoutes);
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
app.use('/api/feature-flags', featureFlagsRoutes);
app.use('/api/email-toggles', emailToggleRoutes);
app.use('/api/database-backups', databaseBackupRoutes);
app.use('/api/page-publication', pagePublicationRoutes);
app.use('/api/open-requisition-report', openRequisitionReportRoutes);
// Express's default 404 page echoes the request path back as HTML; answer with fixed JSON instead.
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});
app.use((err, _req, res, _next) => {
    // Malformed or oversized request bodies are client errors, not server faults.
    const bodyErrorType = err?.type;
    if (bodyErrorType === 'entity.parse.failed')
        return res.status(400).json({ error: 'Malformed request body' });
    if (bodyErrorType === 'entity.too.large')
        return res.status(413).json({ error: 'Request body too large' });
    console.error(err);
    const prismaConnCodes = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1011', 'P1017']);
    if (err instanceof Prisma.PrismaClientInitializationError ||
        (err instanceof Prisma.PrismaClientKnownRequestError &&
            prismaConnCodes.has(err.code))) {
        return res.status(503).json({
            error: env.isProduction
                ? 'Database unavailable.'
                : 'Database unavailable. Check that Postgres is running and DATABASE_URL in .env is correct.',
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
    // Record missing (update/delete on an unknown id) or an id Postgres cannot parse: a client error, not a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return res.status(404).json({ error: 'Not found' });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2023') {
        return res.status(400).json({ error: 'Invalid id' });
    }
    if (err && typeof err === 'object' && 'issues' in err) {
        return res.status(400).json({ error: 'Validation failed' });
    }
    res.status(500).json({ error: 'Internal server error' });
});
