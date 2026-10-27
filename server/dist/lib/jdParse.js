import { rankSkillsInText } from './skills.js';
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
export function parseJobDescriptionSkills(text, catalog = []) {
    const trimmed = text.trim();
    if (!trimmed)
        return { primarySkills: [], secondarySkills: [] };
    // Whole-word catalog hits, most-mentioned first. Required section → primary; the rest → secondary.
    const { requiredText, preferredText } = splitJobDescriptionSections(trimmed);
    const required = rankSkillsInText(requiredText, catalog);
    const preferred = rankSkillsInText(preferredText, catalog);
    const primaryCount = preferred.length > 0 ? 10 : 8;
    const primarySkills = required.slice(0, primaryCount);
    const primarySet = new Set(primarySkills);
    const secondarySkills = [...preferred, ...required.slice(primaryCount)]
        .filter((skill, i, all) => !primarySet.has(skill) && all.indexOf(skill) === i)
        .slice(0, 12);
    if (primarySkills.length === 0) {
        return { primarySkills: secondarySkills.slice(0, 8), secondarySkills: secondarySkills.slice(8) };
    }
    return { primarySkills, secondarySkills };
}
