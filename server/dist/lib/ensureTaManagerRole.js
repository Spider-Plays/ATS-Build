import { prisma } from './prisma.js';
/**
 * One-time data rename of the HR_MANAGER role code to TA_MANAGER.
 * Idempotent: every statement only touches rows that still hold the old code.
 */
export async function ensureTaManagerRole() {
    const statements = [
        `UPDATE "User" SET "role" = 'TA_MANAGER' WHERE "role" = 'HR_MANAGER'`,
        `DELETE FROM "RolePageAccess" WHERE "role" = 'HR_MANAGER' AND EXISTS (SELECT 1 FROM "RolePageAccess" WHERE "role" = 'TA_MANAGER')`,
        `UPDATE "RolePageAccess" SET "role" = 'TA_MANAGER' WHERE "role" = 'HR_MANAGER'`,
        `UPDATE "VendorOnboarding" SET "decidedByRole" = 'TA_MANAGER' WHERE "decidedByRole" = 'HR_MANAGER'`,
        `UPDATE "ClientDeal" SET "createdByRole" = 'TA_MANAGER' WHERE "createdByRole" = 'HR_MANAGER'`,
        `UPDATE "BusinessRequirement" SET "createdByRole" = 'TA_MANAGER' WHERE "createdByRole" = 'HR_MANAGER'`,
        `UPDATE "Requirement" SET "createdByRole" = 'TA_MANAGER' WHERE "createdByRole" = 'HR_MANAGER'`,
        `UPDATE "ActivityLog" SET "performerRole" = 'TA_MANAGER' WHERE "performerRole" = 'HR_MANAGER'`,
        `UPDATE "ChangeRequest" SET "requestedByRole" = 'TA_MANAGER' WHERE "requestedByRole" = 'HR_MANAGER'`,
        // JSON text columns (offer approval chains, saved settings such as offer approval config).
        `UPDATE "Offer" SET "approvalChainJson" = REPLACE("approvalChainJson", '"HR_MANAGER"', '"TA_MANAGER"') WHERE "approvalChainJson" LIKE '%"HR_MANAGER"%'`,
        `UPDATE "AppSetting" SET "value" = REPLACE("value", '"HR_MANAGER"', '"TA_MANAGER"') WHERE "value" LIKE '%"HR_MANAGER"%'`,
    ];
    for (const sql of statements) {
        try {
            await prisma.$executeRawUnsafe(sql);
        }
        catch (err) {
            // A table may not exist yet on a fresh DB; its own ensure step creates it with new values.
            console.warn('[role-rename]', err instanceof Error ? err.message.split('\n')[0] : err);
        }
    }
}
