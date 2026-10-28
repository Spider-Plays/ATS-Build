import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { revokeTrustedDevices } from './mfa.js';
import { bumpTokenVersionAndRevoke } from './sessionTokens.js';
import { unusablePasswordHash } from './legacyImport/unusablePassword.js';
/** The retired dev accounts all lived on this domain and shared one known password. */
const DEV_ACCOUNT_DOMAIN = '@stitch-ats.in';
/** Candidate portal logins the removed demo seed created with that same password. */
const DEMO_CANDIDATE_EMAILS = [
    'aisha.mehta@ats.igsglobal.co',
    'rohan.kapoor@ats.igsglobal.co',
    'neha.iyer@ats.igsglobal.co',
    'vikram.desai@ats.igsglobal.co',
    'priya.nair@ats.igsglobal.co',
    'tanvi.kulkarni@ats.igsglobal.co',
    'siddharth.menon@ats.igsglobal.co',
    'revathi.nair@ats.igsglobal.co',
    'amit.verma@ats.igsglobal.co',
    'deepika.reddy@ats.igsglobal.co',
    'nikhil.chatterjee@ats.igsglobal.co',
    'karan.joshi@ats.igsglobal.co',
    'meera.shah@ats.igsglobal.co',
];
/**
 * Removes every dev and demo login at startup, in whichever database this API runs against. An account
 * that other records still point to cannot be deleted without breaking history, so it is locked
 * for good instead: unusable password, disabled, MFA cleared, every session and device revoked.
 * Idempotent: once every account on the domain is gone or disabled it does nothing.
 */
export async function retireDevAccounts() {
    const accounts = await prisma.user.findMany({
        where: {
            status: { not: 'DISABLED' },
            OR: [
                { email: { endsWith: DEV_ACCOUNT_DOMAIN, mode: 'insensitive' } },
                // Role-scoped so a real staff member who shares a demo name is never touched.
                { email: { in: DEMO_CANDIDATE_EMAILS }, role: 'CANDIDATE' },
            ],
        },
        select: { id: true, email: true },
    });
    for (const account of accounts) {
        try {
            await prisma.user.delete({ where: { id: account.id } });
            console.log(`[security] Deleted dev account ${account.email}`);
            continue;
        }
        catch (err) {
            // P2003: still referenced by other rows (foreign key); lock it below instead.
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003'))
                throw err;
        }
        await prisma.user.update({
            where: { id: account.id },
            data: {
                status: 'DISABLED',
                passwordHash: await unusablePasswordHash(),
                passwordResetToken: null,
                passwordResetExpires: null,
                mfaEnabled: false,
                mfaSecretEnc: null,
                mfaPendingSecretEnc: null,
            },
        });
        await bumpTokenVersionAndRevoke(account.id);
        await revokeTrustedDevices(account.id);
        console.log(`[security] Disabled dev account ${account.email} (linked records kept)`);
    }
}
