import { prisma } from './prisma.js';
import { seedMarketTrendsIfEmpty } from './marketTrends.js';
/** Creates SkillMarketRow / LocationMultiplier when migration was not applied yet. */
export async function ensureMarketTrendsTables() {
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SkillMarketRow" (
      "id" TEXT NOT NULL,
      "capabilityArea" TEXT NOT NULL,
      "framework" TEXT NOT NULL,
      "scriptingLanguage" TEXT NOT NULL,
      "toolsTechnologies" TEXT NOT NULL,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "bands" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SkillMarketRow_pkey" PRIMARY KEY ("id")
    )
  `);
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "LocationMultiplier" (
      "id" TEXT NOT NULL,
      "location" TEXT NOT NULL,
      "multiplier" DOUBLE PRECISION NOT NULL,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT "LocationMultiplier_pkey" PRIMARY KEY ("id")
    )
  `);
    await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "LocationMultiplier_location_key" ON "LocationMultiplier"("location")
  `);
    await seedMarketTrendsIfEmpty();
}
