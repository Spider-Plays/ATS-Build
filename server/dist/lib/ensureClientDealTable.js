import { prisma } from './prisma.js';
/** Creates ClientDeal table and BusinessRequirement.clientDealId when migration was not applied yet. */
export async function ensureClientDealTable() {
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ClientDeal" (
      "id" TEXT NOT NULL,
      "client" TEXT NOT NULL,
      "accountManager" TEXT NOT NULL,
      "hiringManager" TEXT NOT NULL,
      "notes" TEXT,
      "businessStage" TEXT NOT NULL DEFAULT 'INITIAL_DISCUSSION',
      "stagePercentage" INTEGER NOT NULL DEFAULT 10,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "stageHistory" TEXT NOT NULL DEFAULT '[]',
      "createdBy" TEXT,
      "createdByRole" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClientDeal_pkey" PRIMARY KEY ("id")
    )
  `);
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "BusinessRequirement"
      ADD COLUMN IF NOT EXISTS "clientDealId" TEXT
  `);
    await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS "BusinessRequirement_clientDealId_key"
  `);
    await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS "ClientDeal_businessRequirementId_key"
  `);
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "ClientDeal" DROP COLUMN IF EXISTS "businessRequirementId"
  `);
    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "BusinessRequirement_clientDealId_idx"
      ON "BusinessRequirement"("clientDealId")
      WHERE "clientDealId" IS NOT NULL
  `);
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "ClientDeal"
      ADD COLUMN IF NOT EXISTS "sowGatewayReached" BOOLEAN NOT NULL DEFAULT false
  `);
}
