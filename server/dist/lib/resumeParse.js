import mammoth from 'mammoth';
import { isAllowedResumeFile, resolveResumeMime } from './resumeStorage.js';
import { extractSkillsFromText } from './skills.js';
export async function extractResumeText(buffer, mime, filename) {
    if (!isAllowedResumeFile(mime, filename)) {
        throw new Error('Only PDF, DOC, and DOCX files are allowed');
    }
    const resolved = resolveResumeMime(mime, filename);
    const lower = filename.toLowerCase();
    if (resolved === 'application/pdf' || lower.endsWith('.pdf')) {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        try {
            const result = await parser.getText();
            return (result.text || '').trim();
        }
        finally {
            await parser.destroy();
        }
    }
    if (resolved ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lower.endsWith('.docx')) {
        const { value } = await mammoth.extractRawText({ buffer });
        return value.trim();
    }
    throw new Error('Auto-fill works with PDF and DOCX. Save Word files as DOCX or PDF and try again.');
}
export function parseResumeFields(text, catalogNames = []) {
    if (!text.trim())
        return {};
    const lines = text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
    const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?){1,2}\d{3,4}[-.\s]?\d{3,4}(?:[-.\s]?\d{2,6})?/);
    const linkedinMatch = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[\w%-]+/i);
    const portfolioMatch = text.match(/https?:\/\/(?!www\.linkedin\.com)[\w.-]+\.[\w]{2,}(?:\/[\w./?#%+=-]*)?/gi);
    const expMatch = text.match(/(\d+(?:\.\d+)?)\s*\+?\s*(years?|yrs?)(?:\s+of\s+experience)?/i);
    const locationMatch = text.match(/(?:^|\n)\s*(?:location|address|city)\s*[:\-]\s*([^\n]{3,60})/im);
    const nameLine = lines.slice(0, 8).find((line) => {
        if (line.length > 55 || /@|https?:\/\/|linkedin/i.test(line))
            return false;
        const words = line.split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 5)
            return false;
        return words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w));
    });
    let firstName;
    let lastName;
    if (nameLine) {
        const words = nameLine.split(/\s+/);
        firstName = words[0];
        lastName = words.slice(1).join(' ');
    }
    const portfolio = portfolioMatch?.find((u) => !/linkedin\.com/i.test(u)) ?? undefined;
    const extracted = extractSkillsFromText(text, catalogNames);
    const primarySkills = extracted.slice(0, 12);
    const secondarySkills = extracted.slice(12, 24);
    return {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(emailMatch?.[0] && { email: emailMatch[0].toLowerCase() }),
        ...(phoneMatch?.[0] && { phone: phoneMatch[0].replace(/\s+/g, ' ').trim() }),
        ...(linkedinMatch?.[0] && { linkedin: linkedinMatch[0] }),
        ...(portfolio && { portfolio }),
        ...(locationMatch?.[1]?.trim() && { location: locationMatch[1].trim() }),
        ...(expMatch && {
            totalExperience: `${expMatch[1]} Years`,
        }),
        ...(primarySkills.length > 0 && { primarySkills }),
        ...(secondarySkills.length > 0 && { secondarySkills }),
    };
}
export function buildCandidateResumePayload(text, catalogNames = []) {
    const trimmed = text.trim().slice(0, 500_000);
    const extracted = extractSkillsFromText(trimmed, catalogNames);
    return {
        resumeText: trimmed || null,
        primarySkills: JSON.stringify(extracted.slice(0, 15)),
        secondarySkills: JSON.stringify(extracted.slice(15, 30)),
    };
}
