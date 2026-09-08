import { prisma } from './prisma.js';
/** Creates ChangeRequest table when schema is ahead of migrations. */
export async function ensureChangeRequestTable() {
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ChangeRequest" (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      module TEXT NOT NULL,
      page TEXT,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_HR',
      "requestedBy" TEXT NOT NULL,
      "requestedByName" TEXT NOT NULL,
      "requestedByRole" TEXT NOT NULL,
      "hrReviewedBy" TEXT,
      "hrReviewedByName" TEXT,
      "hrReviewedAt" TIMESTAMP(3),
      "hrComment" TEXT,
      "adminReviewedBy" TEXT,
      "adminReviewedByName" TEXT,
      "adminReviewedAt" TIMESTAMP(3),
      "closureComment" TEXT,
      "closedBy" TEXT,
      "closedByName" TEXT,
      "closedAt" TIMESTAMP(3),
      history TEXT NOT NULL DEFAULT '[]',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ChangeRequest_status_createdAt_idx"
    ON "ChangeRequest" (status, "createdAt")
  `);
    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ChangeRequest_requestedBy_createdAt_idx"
    ON "ChangeRequest" ("requestedBy", "createdAt")
  `);
}
