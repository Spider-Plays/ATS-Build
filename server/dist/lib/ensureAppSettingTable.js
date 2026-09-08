import { prisma } from './prisma.js';
/** Creates AppSetting table when schema is ahead of the generated client or DB. */
export async function ensureAppSettingTable() {
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppSetting" (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      "updatedBy" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
