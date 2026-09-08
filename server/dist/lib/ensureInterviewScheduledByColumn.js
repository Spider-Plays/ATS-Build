import { prisma } from './prisma.js';
/** Adds Interview.scheduledBy when schema migration was not applied yet. */
export async function ensureInterviewScheduledByColumn() {
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "Interview" ADD COLUMN IF NOT EXISTS "scheduledBy" TEXT
  `);
    await prisma.$executeRawUnsafe(`
    UPDATE "Interview" i
    SET "scheduledBy" = al."performedBy"
    FROM (
      SELECT DISTINCT ON ("entityId") "entityId", "performedBy"
      FROM "ActivityLog"
      WHERE "entityType" = 'INTERVIEW' AND "action" = 'SCHEDULED'
      ORDER BY "entityId", "timestamp" ASC
    ) al
    WHERE i.id = al."entityId"
      AND i."scheduledBy" IS NULL
  `);
}
