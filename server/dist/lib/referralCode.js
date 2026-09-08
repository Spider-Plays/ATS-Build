import { prisma } from './prisma.js';
function randomSegment(length) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}
export async function ensureUserReferralCode(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true, name: true },
    });
    if (user?.referralCode)
        return user.referralCode;
    for (let attempt = 0; attempt < 8; attempt++) {
        const code = `REF-${randomSegment(6)}`;
        const clash = await prisma.user.findFirst({ where: { referralCode: code } });
        if (!clash) {
            const updated = await prisma.user.update({
                where: { id: userId },
                data: { referralCode: code },
                select: { referralCode: true },
            });
            return updated.referralCode;
        }
    }
    const fallback = `REF-${userId.slice(-8).toUpperCase()}`;
    const updated = await prisma.user.update({
        where: { id: userId },
        data: { referralCode: fallback },
        select: { referralCode: true },
    });
    return updated.referralCode;
}
