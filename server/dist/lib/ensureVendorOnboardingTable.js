import { prisma } from './prisma.js';
/** Creates VendorOnboarding table when schema is ahead of DB. */
export async function ensureVendorOnboardingTable() {
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "VendorOnboarding" (
      "id" TEXT NOT NULL,
      "vendorId" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
      "onboardingJson" TEXT NOT NULL DEFAULT '{}',
      "onboardingCompletedAt" TIMESTAMP(3),
      "evaluationJson" TEXT NOT NULL DEFAULT '{}',
      "evaluationCompletedAt" TIMESTAMP(3),
      "submittedAt" TIMESTAMP(3),
      "submittedBy" TEXT,
      "scoringJson" TEXT,
      "overallPercentage" DOUBLE PRECISION,
      "category" TEXT,
      "evaluatorStrengths" TEXT,
      "evaluatorImprovements" TEXT,
      "evaluatorRisks" TEXT,
      "evaluatorRecommendation" TEXT,
      "decisionReason" TEXT,
      "decidedBy" TEXT,
      "decidedByName" TEXT,
      "decidedByRole" TEXT,
      "decidedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "VendorOnboarding_pkey" PRIMARY KEY ("id")
    )
  `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "VendorOnboarding_vendorId_key" ON "VendorOnboarding"("vendorId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VendorOnboarding_status_idx" ON "VendorOnboarding"("status")`);
    await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'VendorOnboarding_vendorId_fkey'
      ) THEN
        ALTER TABLE "VendorOnboarding"
          ADD CONSTRAINT "VendorOnboarding_vendorId_fkey"
          FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
}
