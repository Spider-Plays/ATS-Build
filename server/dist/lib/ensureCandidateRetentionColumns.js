import { prisma } from './prisma.js';
/** Adds Candidate.anonymizedAt / retentionGroup when the schema push has not been applied yet. */
export async function ensureCandidateRetentionColumns() {
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "anonymizedAt" TIMESTAMP(3)
  `);
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "retentionGroup" TEXT
  `);
}
