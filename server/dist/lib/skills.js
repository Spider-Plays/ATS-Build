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
/** Catalog categories that describe a person, not a technical skill. */
const NON_TECH_SKILL_CATEGORIES = new Set(['soft skills', 'spoken languages', 'domain']);
/** Short catalog names that collide with ordinary words; only count their unambiguous forms. */
const AMBIGUOUS_SKILL_PATTERNS = {
    go: /(?<![a-z0-9])(?:golang|go\s*lang|go\s+(?:programming|developer|language))(?![a-z0-9])/gi,
    r: /(?<![a-z0-9])(?:r\s+programming|r\s+language|rstudio|r\s*shiny)(?![a-z0-9])/gi,
    ca: /(?!)/g,
};
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function catalogEntries(catalog) {
    return catalog.map((c) => (typeof c === 'string' ? { name: c, category: '' } : { name: c.name, category: c.category ?? '' }));
}
/** Whole-word, case-insensitive pattern for a skill (ambiguous short names only in their clear forms). */
export function skillMatchPattern(skill) {
    const key = skill.trim().toLowerCase();
    const ambiguous = AMBIGUOUS_SKILL_PATTERNS[key];
    if (ambiguous)
        return new RegExp(ambiguous.source, 'gi');
    return new RegExp(`(?<![a-z0-9+#])${escapeRegExp(key)}(?![a-z0-9+#])`, 'gi');
}
/**
 * Catalog skills found in text, most-mentioned first (whole-word matches only).
 * Soft skills, spoken languages and industry domains are left out when categories are known.
 */
export function rankSkillsInText(text, catalog) {
    if (!text.trim())
        return [];
    const corpus = text.toLowerCase();
    const hits = [];
    catalogEntries(catalog).forEach((entry, order) => {
        if (NON_TECH_SKILL_CATEGORIES.has(entry.category.toLowerCase()))
            return;
        const count = corpus.match(skillMatchPattern(entry.name))?.length ?? 0;
        if (count > 0)
            hits.push({ name: entry.name, count, order });
    });
    return hits.sort((a, b) => b.count - a.count || a.order - b.order).map((h) => h.name);
}
/** Words that mark a sentence fragment rather than a skill name. */
const PHRASE_FILLER_WORDS = new Set([
    'a', 'an', 'the', 'in', 'of', 'for', 'with', 'using', 'to', 'on', 'at', 'by', 'and', 'or', 'as', 'is', 'are',
    'work', 'working', 'develop', 'developing', 'maintain', 'maintaining', 'build', 'building', 'design', 'designing',
    'experience', 'experienced', 'knowledge', 'strong', 'good', 'excellent', 'hands', 'ability', 'reliable',
    'scalable', 'services', 'engineering', 'years', 'year', 'must', 'should', 'required', 'preferred',
]);
/**
 * Skill-like phrases from a free-text skills cell ("Python, AWS, Okta Workflows").
 * A cell written as a sentence yields nothing — only short, filler-free names are kept.
 */
export function skillPhrasesFromText(raw) {
    const text = raw.trim();
    if (!text || text.split(/\s+/).length > 30 || /[a-z]{3,}\.\s+[A-Z]/.test(text))
        return [];
    return sanitizeSkillList(text
        .split(/[,;|•·\n]|\s+\/\s+/)
        .map((p) => p.trim().replace(/^[-–•*]\s*/, '').replace(/[.:]+$/, ''))
        .filter((p) => {
        const words = p.toLowerCase().split(/\s+/).filter(Boolean);
        return words.length > 0 && words.length <= 3 && p.length <= 40 && !words.some((w) => PHRASE_FILLER_WORDS.has(w));
    }));
}
/**
 * Requirement skills from the recruiter's skills text and the job description:
 * primary = skills named in the skills text (catalog hits + short uncatalogued phrases), else the JD's top skills;
 * secondary = remaining JD skills.
 */
export function deriveRequirementSkills(skillsText, jdText, catalog, limits = { primary: 12, secondary: 12 }) {
    const inSkillsText = rankSkillsInText(skillsText, catalog);
    const catalogLower = catalogEntries(catalog).map((c) => c.name.toLowerCase());
    const extraPhrases = skillPhrasesFromText(skillsText).filter((phrase) => {
        const lower = phrase.toLowerCase();
        return !catalogLower.some((name) => skillMatchPattern(name).test(lower));
    });
    const inJd = rankSkillsInText(jdText, catalog);
    const seen = new Set();
    const pick = (list, max) => {
        const out = [];
        for (const s of list) {
            const key = s.toLowerCase();
            if (seen.has(key) || out.length >= max)
                continue;
            seen.add(key);
            out.push(s);
        }
        return out;
    };
    // Too few real skills named (e.g. "cloud engineering"): top primary up with the JD's most-mentioned skills.
    const fromSkillsText = [...inSkillsText, ...extraPhrases];
    const topUp = inSkillsText.length < 3 ? inJd.slice(0, Math.max(0, 8 - fromSkillsText.length)) : [];
    const primary = pick([...fromSkillsText, ...topUp], limits.primary);
    const secondary = pick(inJd, limits.secondary);
    return { primary, secondary };
}
/**
 * Merge recruiter-entered skills with resume skills: sheet values stay first,
 * the most-mentioned resume skills fill primary, the rest go to secondary.
 */
export function mergeResumeSkills(sheetPrimary, sheetSecondary, ranked, limits = { primary: 10, secondary: 15 }) {
    const seen = new Set();
    const take = (list, max) => {
        const out = [];
        for (const s of list) {
            const key = s.trim().toLowerCase();
            if (!key || seen.has(key) || out.length >= max)
                continue;
            seen.add(key);
            out.push(s.trim());
        }
        return out;
    };
    const primary = take([...sheetPrimary, ...ranked], limits.primary);
    const secondary = take([...sheetSecondary, ...ranked], limits.secondary);
    return { primary, secondary };
}
