import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { findResumeFile } from '../../lib/resumeStorage.js';
const emails = [
    'vinitha2000devadiga@gmail.com',
    'rubanofficial06@gmail.com',
    'sharmaswati.2k2@gmail.com',
];
const jobCodes = ['25372438', '24632364'];
export async function run(_argv = []) {
    const reqs = await prisma.requirement.findMany({
        where: { jobCode: { in: jobCodes } },
        select: { id: true, jobCode: true, title: true, client: true },
    });
    const cands = await prisma.candidate.findMany({
        where: { email: { in: emails } },
        select: {
            id: true,
            email: true,
            status: true,
            requirementId: true,
            resumeFileName: true,
            resumeText: true,
        },
    });
    const candidateIds = cands.map((c) => c.id);
    const interviews = await prisma.interview.count({
        where: { candidateId: { in: candidateIds } },
    });
    const feedback = await prisma.feedback.count({
        where: { candidateId: { in: candidateIds } },
    });
    const resumeChecks = await Promise.all(cands.map(async (c) => {
        const stored = await findResumeFile(c.id);
        return {
            email: c.email,
            resumeFileName: c.resumeFileName,
            onDisk: Boolean(stored),
            resumeTextLength: c.resumeText?.length ?? 0,
        };
    }));
    console.log(JSON.stringify({
        requirements: reqs.length,
        requirementsDetail: reqs,
        candidates: cands.length,
        statuses: Object.fromEntries(cands.map((c) => [c.email, c.status])),
        interviews,
        feedback,
        resumeChecks,
        ok: reqs.length === 2 &&
            cands.length === 3 &&
            interviews === 3 &&
            resumeChecks.every((r) => r.onDisk && r.resumeTextLength > 0),
    }, null, 2));
}
