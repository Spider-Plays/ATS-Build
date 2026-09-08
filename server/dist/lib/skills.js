/** Parse comma/newline-separated skill input into a deduped list. */
export function parseSkillList(input) {
    if (Array.isArray(input)) {
        return sanitizeSkillList(input.map((s) => String(s).trim()).filter(Boolean));
    }
    if (typeof input !== 'string')
        return [];
    const trimmed = input.trim();
    if (!trimmed)
        return [];
    if (trimmed.startsWith('[')) {
        return sanitizeSkillList(deserializeSkills(trimmed));
    }
    return sanitizeSkillList(trimmed
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean));
}
export function serializeSkills(skills) {
    return JSON.stringify(sanitizeSkillList(skills));
}
export function deserializeSkills(raw) {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return sanitizeSkillList(parsed.map((s) => String(s).trim()).filter(Boolean));
        }
        if (typeof parsed === 'string' && parsed.trim()) {
            return sanitizeSkillList([parsed.trim()]);
        }
        return [];
    }
    catch {
        return sanitizeSkillList(raw
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean));
    }
}
const SKILL_SECTION_HEADERS = /^(contact|contacts|email|e-mail|phone|mobile|tel|address|location|personal|profile|summary|experience|employment|education|references?|projects?|certifications?|skills?|technical\s+skills?|objective)$/i;
const EMAIL_IN_SKILL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_IN_SKILL = /^\+?\d[\d\s().-]{7,}\d$/;
function isSectionHeaderLabel(label) {
    const compact = label.replace(/\s+/g, '');
    if (SKILL_SECTION_HEADERS.test(label) || SKILL_SECTION_HEADERS.test(compact)) {
        return true;
    }
    const parts = label.trim().split(/\s+/);
    if (parts.length >= 3 && parts.every((part) => part.length === 1)) {
        return SKILL_SECTION_HEADERS.test(parts.join(''));
    }
    return false;
}
/** Drop contact lines, section headers, and other non-skill tokens from skill lists. */
export function sanitizeSkillList(skills) {
    return [
        ...new Set(skills
            .map((s) => s.trim().replace(/^["'\[\]|]+|["'\[\]|]+$/g, '').trim())
            .filter(Boolean)
            .filter((s) => s.length >= 2 && s.length <= 60)
            .filter((s) => !isSectionHeaderLabel(s))
            .filter((s) => !EMAIL_IN_SKILL.test(s))
            .filter((s) => !PHONE_IN_SKILL.test(s.replace(/\s/g, '')))
            .filter((s) => !/^[\d\s()+-]+$/.test(s))
            .filter((s) => /[a-zA-Z#+]/.test(s))),
    ];
}
export function normalizeSkillToken(skill) {
    return skill
        .toLowerCase()
        .replace(/[^a-z0-9+#.]/g, '')
        .trim();
}
/** Extract skill-like tokens from resume/JD text using the skill catalog when provided. */
export function extractSkillsFromText(text, catalogNames = []) {
    if (!text.trim())
        return [];
    const found = new Set();
    const lower = text.toLowerCase();
    const normalizedCorpus = lower.replace(/[^a-z0-9+#.\s]/g, ' ');
    for (const name of catalogNames) {
        const token = normalizeSkillToken(name);
        if (!token || token.length < 2)
            continue;
        const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (pattern.test(normalizedCorpus) || normalizedCorpus.includes(token)) {
            found.add(name);
        }
    }
    const skillsSection = text.match(/(?:^|\n)\s*(?:technical\s+skills?|core\s+competencies|skills?(?:\s+&\s+technologies)?|technologies|expertise)\s*[:\-]?\s*\n([\s\S]{10,400})/im);
    if (skillsSection?.[1]) {
        let chunk = skillsSection[1].split(/\n\n|\n(?=[A-Z][A-Za-z\s]{2,20}:?\s*\n)/)[0] ?? skillsSection[1];
        const stopAt = chunk.search(/\n\s*(?:contact|personal|education|experience|employment|projects?|certifications?|references?)\s*[:\-]?\s*\n/i);
        if (stopAt >= 0)
            chunk = chunk.slice(0, stopAt);
        for (const part of chunk.split(/[,;|•·\n]/)) {
            const cleaned = part.trim().replace(/^[-–•]\s*/, '');
            if (cleaned.length >= 2 &&
                cleaned.length <= 40 &&
                !/^\d+$/.test(cleaned) &&
                !isSectionHeaderLabel(cleaned)) {
                found.add(cleaned);
            }
        }
    }
    return sanitizeSkillList([...found]).slice(0, 40);
}
