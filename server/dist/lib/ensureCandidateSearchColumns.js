import { prisma } from './prisma.js';
/**
 * Adds candidate-search helper columns / indexes when the Prisma schema is ahead of the DB.
 */
export async function ensureCandidateSearchColumns() {
    const statements = [
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "experienceYears" DOUBLE PRECISION',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "currentCtcLakhs" DOUBLE PRECISION',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "expectedCtcLakhs" DOUBLE PRECISION',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "noticePeriodDays" INTEGER',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "searchText" TEXT',
        'CREATE INDEX IF NOT EXISTS "Candidate_experienceYears_idx" ON "Candidate"("experienceYears")',
        'CREATE INDEX IF NOT EXISTS "Candidate_currentCtcLakhs_idx" ON "Candidate"("currentCtcLakhs")',
        'CREATE INDEX IF NOT EXISTS "Candidate_expectedCtcLakhs_idx" ON "Candidate"("expectedCtcLakhs")',
        'CREATE INDEX IF NOT EXISTS "Candidate_noticePeriodDays_idx" ON "Candidate"("noticePeriodDays")',
        'CREATE INDEX IF NOT EXISTS "Candidate_status_idx" ON "Candidate"("status")',
        'CREATE INDEX IF NOT EXISTS "Candidate_source_idx" ON "Candidate"("source")',
        'CREATE INDEX IF NOT EXISTS "Candidate_appliedDate_idx" ON "Candidate"("appliedDate")',
        `CREATE INDEX IF NOT EXISTS "Candidate_searchText_fts_idx" ON "Candidate" USING GIN (to_tsvector('english', coalesce("searchText", '')))`,
    ];
    for (const sql of statements) {
        await prisma.$executeRawUnsafe(sql);
    }
    try {
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
        await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Candidate_location_trgm_idx" ON "Candidate" USING GIN ("location" gin_trgm_ops)');
        await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Candidate_currentCompany_trgm_idx" ON "Candidate" USING GIN ("currentCompany" gin_trgm_ops)');
    }
    catch (err) {
        console.warn('[ensureCandidateSearchColumns] pg_trgm indexes skipped:', err instanceof Error ? err.message : err);
    }
}
