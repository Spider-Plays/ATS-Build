import { prisma } from './prisma.js';
/**
 * Adds approvalChainJson when the Prisma schema is ahead of the DB
 * (e.g. after pulling changes without running db push / migrate).
 */
export async function ensureOfferApprovalChainColumn() {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "approvalChainJson" TEXT NOT NULL DEFAULT '[]'`);
}
