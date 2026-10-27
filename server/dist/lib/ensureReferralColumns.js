import { prisma } from './prisma.js';
/**
 * Adds referral portal columns when the Prisma schema is ahead of the DB.
 */
export async function ensureReferralColumns() {
    const statements = [
        'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "visibleToReferrals" BOOLEAN NOT NULL DEFAULT true',
        'ALTER TABLE "Requirement" ADD COLUMN IF NOT EXISTS "referralBonusAmount" INTEGER',
        'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referredByUserId" TEXT',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralRelationship" TEXT',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralNotes" TEXT',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralStage" TEXT',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralAssignedToUserId" TEXT',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralAssignedAt" TIMESTAMP(3)',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralRejectionReason" TEXT',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralReviewedAt" TIMESTAMP(3)',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralBonusStatus" TEXT',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralBonusAmount" INTEGER',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralBonusEligibleOn" TIMESTAMP(3)',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralBonusDecidedBy" TEXT',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralBonusDecidedAt" TIMESTAMP(3)',
        'ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "referralBonusNote" TEXT',
    ];
    for (const sql of statements) {
        await prisma.$executeRawUnsafe(sql);
    }
    await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode") WHERE "referralCode" IS NOT NULL');
}
