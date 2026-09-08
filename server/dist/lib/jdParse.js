import { extractSkillsFromText } from './skills.js';
const PREFERRED_SECTION = /(?:^|\n)\s*(?:preferred\s+qualifications?|nice\s+to\s+have|desired\s+skills?|bonus\s+skills?|optional\s+skills?|good\s+to\s+have)\s*[:\-]?\s*/im;
/** Split JD text into required vs preferred sections when headings are present. */
function splitJobDescriptionSections(text) {
    const match = text.match(PREFERRED_SECTION);
    if (!match || match.index === undefined) {
        return { requiredText: text, preferredText: '' };
    }
    return {
        requiredText: text.slice(0, match.index),
        preferredText: text.slice(match.index),
    };
}
/** Extract primary and secondary skills from a job description. */
export function parseJobDescriptionSkills(text, catalogNames = []) {
    const trimmed = text.trim();
    if (!trimmed)
        return { primarySkills: [], secondarySkills: [] };
    const { requiredText, preferredText } = splitJobDescriptionSections(trimmed);
    let primarySkills = extractSkillsFromText(requiredText, catalogNames);
    let secondarySkills = extractSkillsFromText(preferredText, catalogNames);
    const primarySet = new Set(primarySkills);
    secondarySkills = secondarySkills.filter((skill) => !primarySet.has(skill));
    if (primarySkills.length === 0 && secondarySkills.length === 0) {
        const all = extractSkillsFromText(trimmed, catalogNames);
        return {
            primarySkills: all.slice(0, 8),
            secondarySkills: all.slice(8, 16),
        };
    }
    if (primarySkills.length === 0 && secondarySkills.length > 0) {
        const splitAt = Math.ceil(secondarySkills.length / 2);
        return {
            primarySkills: secondarySkills.slice(0, splitAt),
            secondarySkills: secondarySkills.slice(splitAt),
        };
    }
    return {
        primarySkills: primarySkills.slice(0, 12),
        secondarySkills: secondarySkills.slice(0, 12),
    };
}
