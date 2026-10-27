import { prisma } from './prisma.js';
import { deleteResumeFile } from './resumeStorage.js';
const REMOVED_TEXT = '[removed under retention policy]';
async function deletePortalUser(email) {
    const portalUser = await prisma.user.findFirst({
        where: { email: email.toLowerCase(), role: 'CANDIDATE' },
    });
    if (portalUser)
        await prisma.user.delete({ where: { id: portalUser.id } });
}
/** Hard delete: the candidate row and everything hanging off it (DPDP erasure). */
export async function eraseCandidateRecords(row) {
    const interviews = await prisma.interview.findMany({
        where: { candidateId: row.id },
        select: { id: true },
    });
    const interviewIds = interviews.map((i) => i.id);
    await prisma.$transaction([
        prisma.feedback.deleteMany({
            where: { OR: [{ candidateId: row.id }, { interviewId: { in: interviewIds } }] },
        }),
        prisma.interview.deleteMany({ where: { candidateId: row.id } }),
        prisma.offer.deleteMany({ where: { candidateId: row.id } }),
        prisma.activityLog.deleteMany({ where: { entityType: 'CANDIDATE', entityId: row.id } }),
    ]);
    await deleteResumeFile(row.id, row.resumeStorageKey);
    await deletePortalUser(row.email);
    await prisma.candidate.delete({ where: { id: row.id } });
}
/**
 * Keeps the row (status, source, dates, requisition, skills, offer amounts) so reports still add up,
 * and strips everything that identifies the person or came from their documents.
 * `keepName` is used for hired candidates, whose name stays on the minimal hire record.
 */
export async function anonymizeCandidateRecords(row, opts) {
    const now = opts.now ?? new Date();
    await prisma.$transaction([
        prisma.candidate.update({
            where: { id: row.id },
            data: {
                name: opts.keepName ? row.name : 'Anonymised candidate',
                email: `anonymized-${row.id}@anonymized.invalid`,
                phone: null,
                avatar: null,
                resumeUrl: null,
                resumeFileName: null,
                resumeMimeType: null,
                resumeStorageKey: null,
                resumeText: null,
                location: null,
                preferredLocation: null,
                linkedIn: null,
                portfolio: null,
                currentCompany: null,
                currentCTC: null,
                expectedCTC: null,
                currentCtcLakhs: null,
                expectedCtcLakhs: null,
                pan: null,
                searchText: null,
                referralNotes: null,
                referralRelationship: null,
                referralRejectionReason: null,
                anonymizedAt: now,
                retentionGroup: opts.group,
            },
        }),
        prisma.interview.updateMany({
            where: { candidateId: row.id },
            data: { description: null, meetingLink: null, location: null, calendarEventId: null },
        }),
        prisma.feedback.updateMany({
            where: { candidateId: row.id },
            data: { comments: REMOVED_TEXT, formData: '{}' },
        }),
        prisma.offer.updateMany({
            where: { candidateId: row.id },
            data: {
                letterContent: null,
                letterHtml: null,
                letterPdfKey: null,
                letterMetaJson: '{}',
                rejectionReason: null,
            },
        }),
        prisma.activityLog.updateMany({
            where: { entityType: 'CANDIDATE', entityId: row.id },
            data: { details: null },
        }),
    ]);
    await deleteResumeFile(row.id, row.resumeStorageKey);
    await deletePortalUser(row.email);
}
