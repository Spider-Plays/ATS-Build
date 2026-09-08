import { prisma } from '../lib/prisma.js';
export async function logActivity(data) {
    try {
        let performerName = data.performerName;
        let performerRole = data.performerRole;
        if (!performerName && data.performedBy) {
            const u = await prisma.user.findUnique({
                where: { id: data.performedBy },
                select: { name: true, role: true },
            });
            performerName = u?.name;
            performerRole = performerRole ?? u?.role;
        }
        await prisma.activityLog.create({
            data: {
                entityType: data.entityType,
                entityId: data.entityId,
                action: data.action,
                performedBy: data.performedBy,
                performerName: performerName ?? null,
                performerRole: performerRole ?? null,
                details: data.details ? JSON.stringify(data.details) : null,
                ...(data.timestamp ? { timestamp: new Date(data.timestamp) } : {}),
                seed: data.seed ?? false,
            },
        });
    }
    catch (e) {
        console.error('Activity log failed:', e);
    }
}
/** Logs interview events on the candidate profile activity tab. */
export async function logCandidateInterviewActivity(data) {
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: data.candidateId,
        action: data.action,
        performedBy: data.performedBy,
        performerRole: data.performerRole,
        details: { interviewId: data.interviewId, ...data.details },
    });
}
