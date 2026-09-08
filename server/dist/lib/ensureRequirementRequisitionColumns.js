import { prisma } from './prisma.js';
const STATEMENTS = [
    'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "businessType" TEXT',
    'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "domain" TEXT',
    'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "jobType" TEXT',
    'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "employmentChannel" TEXT',
    'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "requirementFor" TEXT',
    'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "replacementEmployeeName" TEXT',
    `ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "education" TEXT NOT NULL DEFAULT '[]'`,
    'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "hireCategory" TEXT',
    'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "holdStartDate" TIMESTAMP(3)',
    'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "holdEndDate" TIMESTAMP(3)',
    `ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "positionSlots" TEXT NOT NULL DEFAULT '[]'`,
];
/** Idempotent column adds for requisition field overhaul (Neon / deploy). */
export async function ensureRequirementRequisitionColumns() {
    for (const sql of STATEMENTS) {
        await prisma.$executeRawUnsafe(sql);
    }
}
