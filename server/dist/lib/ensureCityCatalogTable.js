import { prisma } from './prisma.js';
/** Creates CityCatalog table when schema migration was not applied yet. */
export async function ensureCityCatalogTable() {
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CityCatalog" (
      "id" TEXT NOT NULL,
      "city" TEXT NOT NULL,
      "state" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CityCatalog_pkey" PRIMARY KEY ("id")
    )
  `);
    await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CityCatalog_city_key" ON "CityCatalog"("city")
  `);
}
