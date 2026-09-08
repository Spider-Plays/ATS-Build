import { renderDemoCandidateResumePdf } from './demoResumePdf.js';
import { readCandidateResumeFromDisk, readCandidateResumeFromUrl, saveResumeFile, } from './resumeStorage.js';
function parseSkillList(raw) {
    if (!raw?.trim())
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
    }
    catch {
        return [];
    }
}
export async function loadCandidateResume(candidate) {
    if (!candidate.resumeFileName?.trim())
        return null;
    const fileName = candidate.resumeFileName;
    const mime = candidate.resumeMimeType || 'application/pdf';
    const fromDisk = await readCandidateResumeFromDisk(candidate);
    if (fromDisk) {
        return { buffer: fromDisk.buffer, mime: candidate.resumeMimeType || fromDisk.mime, fileName };
    }
    if (candidate.resumeUrl) {
        const fromUrl = await readCandidateResumeFromUrl(candidate.resumeUrl, candidate.resumeMimeType);
        if (fromUrl) {
            return { buffer: fromUrl.buffer, mime: candidate.resumeMimeType || fromUrl.mime, fileName };
        }
    }
    if (!candidate.resumeText?.trim())
        return null;
    try {
        const buffer = await renderDemoCandidateResumePdf({
            name: candidate.name,
            email: candidate.email,
            role: candidate.role,
            location: candidate.location,
            summary: candidate.resumeText,
            primarySkills: parseSkillList(candidate.primarySkills),
            secondarySkills: parseSkillList(candidate.secondarySkills),
        });
        await saveResumeFile(candidate.id, mime, buffer, fileName, candidate.resumeStorageKey);
        return { buffer, mime: 'application/pdf', fileName };
    }
    catch (err) {
        console.error(`[resume] Fallback PDF generation failed for ${candidate.id}:`, err instanceof Error ? err.message : err);
        return null;
    }
}
