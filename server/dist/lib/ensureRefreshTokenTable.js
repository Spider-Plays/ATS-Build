import { prisma } from './prisma.js';
/** Adds tokenVersion + RefreshToken when the Prisma schema is ahead of the DB. */
export async function ensureRefreshTokenTable() {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0`);
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RefreshToken" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "familyId" TEXT NOT NULL,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "revokedAt" TIMESTAMP(3),
      "replacedById" TEXT,
      "userAgent" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
    )
  `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RefreshToken_userId_idx" ON "RefreshToken"("userId")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "RefreshToken_familyId_idx" ON "RefreshToken"("familyId")`);
    await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'RefreshToken_userId_fkey'
      ) THEN
        ALTER TABLE "RefreshToken"
          ADD CONSTRAINT "RefreshToken_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
}
