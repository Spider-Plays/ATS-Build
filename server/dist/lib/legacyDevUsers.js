import { DEV_USERS } from '../config/devUsers.js';
function legacyDevEmail(canonicalEmail) {
    const [local] = canonicalEmail.toLowerCase().split('@');
    return `dev-${local}@ats.igsglobal.co`;
}
async function reassignUserReferences(prisma, fromUserId, toUserId) {
    if (fromUserId === toUserId)
        return;
    await prisma.$transaction([
        prisma.loginHistory.updateMany({
            where: { userId: fromUserId },
            data: { userId: toUserId },
        }),
        prisma.requirement.updateMany({
            where: { createdBy: fromUserId },
            data: { createdBy: toUserId },
        }),
        prisma.candidate.updateMany({
            where: { createdBy: fromUserId },
            data: { createdBy: toUserId },
        }),
        prisma.candidate.updateMany({
            where: { submittedByUserId: fromUserId },
            data: { submittedByUserId: toUserId },
        }),
        prisma.candidate.updateMany({
            where: { referredByUserId: fromUserId },
            data: { referredByUserId: toUserId },
        }),
        prisma.offer.updateMany({
            where: { createdBy: fromUserId },
            data: { createdBy: toUserId },
        }),
        prisma.vendorRequirement.updateMany({
            where: { assignedBy: fromUserId },
            data: { assignedBy: toUserId },
        }),
        prisma.activityLog.updateMany({
            where: { performedBy: fromUserId },
            data: { performedBy: toUserId },
        }),
        prisma.feedback.updateMany({
            where: { interviewerId: fromUserId },
            data: { interviewerId: toUserId },
        }),
    ]);
    const interviews = await prisma.interview.findMany({
        where: { interviewerIds: { contains: fromUserId } },
        select: { id: true, interviewerIds: true },
    });
    for (const row of interviews) {
        try {
            const ids = JSON.parse(row.interviewerIds || '[]');
            if (!ids.includes(fromUserId))
                continue;
            const next = [...new Set(ids.map((id) => (id === fromUserId ? toUserId : id)))];
            await prisma.interview.update({
                where: { id: row.id },
                data: { interviewerIds: JSON.stringify(next) },
            });
        }
        catch {
            // skip malformed interviewerIds
        }
    }
}
/** Merge or remove legacy dev-*@ats.igsglobal.co and @local.test accounts before seeding. */
export async function removeLegacyDevUsers(prisma) {
    let merged = 0;
    let deleted = 0;
    for (const spec of DEV_USERS) {
        const canonicalEmail = spec.email.toLowerCase();
        const legacyEmail = legacyDevEmail(canonicalEmail);
        const [canonicalUser, legacyUser] = await Promise.all([
            prisma.user.findUnique({ where: { email: canonicalEmail } }),
            prisma.user.findUnique({ where: { email: legacyEmail } }),
        ]);
        if (!legacyUser)
            continue;
        if (canonicalUser && canonicalUser.id !== legacyUser.id) {
            await reassignUserReferences(prisma, legacyUser.id, canonicalUser.id);
            await prisma.user.delete({ where: { id: legacyUser.id } });
            deleted++;
            continue;
        }
        if (!canonicalUser) {
            await prisma.user.update({
                where: { id: legacyUser.id },
                data: {
                    email: canonicalEmail,
                    name: spec.name,
                    role: spec.role,
                    department: 'department' in spec ? spec.department : legacyUser.department,
                },
            });
            merged++;
        }
    }
    const patternDeleted = await prisma.user.deleteMany({
        where: {
            OR: [
                { email: { endsWith: '@local.test' } },
                { email: { endsWith: '@staffing.local.test' } },
                {
                    AND: [
                        { email: { startsWith: 'dev-' } },
                        {
                            OR: [
                                { email: { endsWith: '@stitch.com' } },
                                { email: { endsWith: '@Stitch.com' } },
                                { email: { endsWith: '@ats.igsglobal.co' } },
                            ],
                        },
                    ],
                },
                { email: { endsWith: '@Stitch.com' } },
                { email: { endsWith: '@stitch.com' } },
            ],
        },
    });
    return {
        merged,
        deleted,
        patternDeleted: patternDeleted.count,
    };
}
