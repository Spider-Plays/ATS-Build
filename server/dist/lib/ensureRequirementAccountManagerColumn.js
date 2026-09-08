import { prisma } from './prisma.js';
/** Adds Requirement.accountManager when schema migration was not applied yet. */
export async function ensureRequirementAccountManagerColumn() {
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "accountManager" TEXT
  `);
}
