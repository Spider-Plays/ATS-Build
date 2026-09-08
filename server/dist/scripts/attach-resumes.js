import { prisma } from '../lib/prisma.js';
import { buildCandidateResumePayload } from '../lib/resumeParse.js';
import { demoResumeFileName, renderDemoCandidateResumePdf } from '../lib/demoResumePdf.js';
import { closePdfBrowser } from '../lib/offerPdf.js';
import { saveResumeFile } from '../lib/resumeStorage.js';
import { parseSkillList } from '../lib/skills.js';
async function attachResumeToCandidate(candidate) {
    const snippet = candidate.resumeText?.trim() ||
        `${candidate.name} — experienced ${candidate.role}. Demo resume for Stitch ATS.`;
    const fileName = demoResumeFileName(candidate.name);
    const textPayload = buildCandidateResumePayload(snippet);
    const primarySkills = parseSkillList(candidate.primarySkills);
    const secondarySkills = parseSkillList(candidate.secondarySkills);
    const buffer = await renderDemoCandidateResumePdf({
        name: candidate.name,
        email: candidate.email,
        role: candidate.role,
        location: candidate.location,
        summary: snippet,
        primarySkills,
        secondarySkills,
    });
    await saveResumeFile(candidate.id, 'application/pdf', buffer, fileName);
    await prisma.candidate.update({
        where: { id: candidate.id },
        data: {
            resumeFileName: fileName,
            resumeMimeType: 'application/pdf',
            resumeUrl: null,
            resumeStorageKey: null,
            resumeText: candidate.resumeText?.trim() ? candidate.resumeText : textPayload.resumeText,
            primarySkills: candidate.primarySkills || textPayload.primarySkills,
            secondarySkills: candidate.secondarySkills || textPayload.secondarySkills,
        },
    });
}
async function main() {
    const candidates = await prisma.candidate.findMany({
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            location: true,
            resumeText: true,
            primarySkills: true,
            secondarySkills: true,
            resumeFileName: true,
        },
        orderBy: { email: 'asc' },
    });
    if (candidates.length === 0) {
        console.log('No candidates found.');
        return;
    }
    console.log(`Attaching demo resume PDFs to ${candidates.length} candidate(s)...`);
    let attached = 0;
    for (const candidate of candidates) {
        try {
            await attachResumeToCandidate(candidate);
            attached++;
            console.log(`  ✓ ${candidate.email}`);
        }
        catch (err) {
            console.error(`  ✗ ${candidate.email}:`, err);
        }
    }
    console.log(`\nDone. Attached ${attached}/${candidates.length} resume(s).`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await closePdfBrowser();
    await prisma.$disconnect();
});
