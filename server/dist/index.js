import { databaseHostLabel } from './config/loadEnv.js';
import { app } from './app.js';
import { env } from './config/env.js';
import { assertPrismaClientModels, prisma } from './lib/prisma.js';
import { ensureCandidateMilestoneColumns } from './lib/ensureCandidateMilestoneColumns.js';
import { ensureCandidateSearchColumns } from './lib/ensureCandidateSearchColumns.js';
import { ensureCandidateSearchBackfill } from './lib/ensureCandidateSearchBackfill.js';
import { ensureReferralColumns } from './lib/ensureReferralColumns.js';
import { ensureOfferApprovalChainColumn } from './lib/ensureOfferApprovalChainColumn.js';
import { ensureVendorOnboardingTable } from './lib/ensureVendorOnboardingTable.js';
import { ensureBusinessRequirementTable } from './lib/ensureBusinessRequirementTable.js';
import { ensureClientDealTable } from './lib/ensureClientDealTable.js';
import { ensureRequirementAccountManagerColumn } from './lib/ensureRequirementAccountManagerColumn.js';
import { ensureRequirementRequisitionColumns } from './lib/ensureRequirementRequisitionColumns.js';
import { ensureInterviewScheduledByColumn } from './lib/ensureInterviewScheduledByColumn.js';
import { ensurePrimaryDevUsers } from './lib/ensurePrimaryDevUsers.js';
import { ensureRolePageAccessPatches } from './lib/ensureRolePageAccessPatches.js';
import { ensureRefreshTokenTable } from './lib/ensureRefreshTokenTable.js';
import { ensureChangeRequestTable } from './lib/ensureChangeRequestTable.js';
import { ensureAppSettingTable } from './lib/ensureAppSettingTable.js';
import { ensureCityCatalogTable } from './lib/ensureCityCatalogTable.js';
import { syncDefaultCityCatalog } from './lib/cityCatalog.js';
import { ensureMarketTrendsTables } from './lib/ensureMarketTrendsTables.js';
import { startInterviewReminderJob, startRequirementAgingAlertJob } from './lib/emailDispatch.js';
import { startCandidateScreeningJob } from './lib/candidateStatuses.js';
try {
    assertPrismaClientModels();
}
catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
}
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection (API still running):', reason);
});
async function prepareDatabase() {
    await prisma.$queryRaw `SELECT 1`;
    console.log('Database connected');
    await ensureCandidateMilestoneColumns();
    await ensureCandidateSearchColumns();
    await ensureCandidateSearchBackfill();
    await ensureReferralColumns();
    await ensureAppSettingTable();
    await ensureCityCatalogTable();
    await syncDefaultCityCatalog();
    await ensureMarketTrendsTables();
    await ensureOfferApprovalChainColumn();
    await ensureVendorOnboardingTable();
    await ensureBusinessRequirementTable();
    await ensureClientDealTable();
    await ensureRequirementAccountManagerColumn();
    await ensureRequirementRequisitionColumns();
    await ensureInterviewScheduledByColumn();
    await ensurePrimaryDevUsers();
    await ensureChangeRequestTable();
    await ensureRolePageAccessPatches();
    await ensureRefreshTokenTable();
    startInterviewReminderJob();
    startRequirementAgingAlertJob();
    startCandidateScreeningJob();
}
async function start() {
    try {
        await prepareDatabase();
    }
    catch (e) {
        console.warn('Database not reachable or schema prep failed — some routes may error until Postgres is reachable:', e instanceof Error ? e.message : e);
    }
    const dbHost = databaseHostLabel();
    const server = app.listen(env.port, () => {
        console.log(`API running at http://localhost:${env.port}${dbHost ? ` -> ${dbHost}` : ''}`);
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${env.port} is already in use. Stop the other process or change PORT in the root .env`);
            process.exit(1);
        }
        throw err;
    });
}
start().catch((e) => {
    console.error('Failed to start API:', e instanceof Error ? e.message : e);
    process.exit(1);
});
