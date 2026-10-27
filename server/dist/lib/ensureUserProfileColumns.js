import { prisma } from './prisma.js';
/** Adds user and login-history columns when schema migration was not applied yet. */
export async function ensureUserProfileColumns() {
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustCompleteProfile" BOOLEAN NOT NULL DEFAULT false
  `);
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "LoginHistory" ADD COLUMN IF NOT EXISTS "loggedOutAt" TIMESTAMP(3)
  `);
    await prisma.$executeRawUnsafe(`
    ALTER TABLE "LoginHistory" ADD COLUMN IF NOT EXISTS "logoutReason" TEXT
  `);
    await ensureEmailVerifiedColumn();
}
/**
 * Adds "emailVerifiedAt". Accounts that already exist are grandfathered as verified, but only on
 * the run that creates the column, so accounts registered afterwards stay unverified until proven.
 */
async function ensureEmailVerifiedColumn() {
    const existing = await prisma.$queryRaw `
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'emailVerifiedAt' AND table_schema = current_schema()
  `;
    if (existing.length > 0)
        return;
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3)`);
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL`);
}
