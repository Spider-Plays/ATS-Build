const SECTION_PATTERN = /(?:^|\n)\s*(?:technical\s+skills?|skills?(?:\s+&\s+technologies)?|core\s+competencies|technologies|expertise|professional\s+experience|work\s+experience|experience|employment\s+history|projects?(?:\s+&?\s*portfolio)?|key\s+projects|selected\s+projects|personal\s+projects|summary|profile)\s*[:\-]?\s*\n/gim;
const BULLET_LINE = /^\s*(?:[•\-–*●◦]|\d+[.)])\s+(.+)$/;
/** Split resume text into labeled sections when headings are present. */
export function splitResumeSections(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return {};
    const sections = {};
    const matches = [...trimmed.matchAll(SECTION_PATTERN)];
    if (matches.length === 0) {
        sections.body = trimmed;
        return sections;
    }
    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const header = match[0]
            .trim()
            .replace(/[:\-]\s*$/, '')
            .toLowerCase();
        const start = (match.index ?? 0) + match[0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index ?? trimmed.length : trimmed.length;
        const body = trimmed.slice(start, end).trim();
        if (!body)
            continue;
        if (/skill|technolog|competenc|expertise/.test(header)) {
            sections.skills = sections.skills ? `${sections.skills}\n${body}` : body;
        }
        else if (/project/.test(header)) {
            sections.projects = sections.projects ? `${sections.projects}\n${body}` : body;
        }
        else if (/experience|employment/.test(header)) {
            sections.experience = sections.experience ? `${sections.experience}\n${body}` : body;
        }
        else if (/summary|profile/.test(header)) {
            sections.summary = body;
        }
        else {
            sections.body = sections.body ? `${sections.body}\n${body}` : body;
        }
    }
    return sections;
}
/** Pull bullet lines and paragraph blocks that read like project or role descriptions. */
export function extractResumeBullets(text) {
    const bullets = [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
        const bullet = line.match(BULLET_LINE);
        if (bullet?.[1] && bullet[1].length >= 12) {
            bullets.push(bullet[1].trim());
        }
    }
    if (bullets.length > 0)
        return dedupeBullets(bullets);
    const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter((p) => p.length >= 40 && p.length <= 600);
    return dedupeBullets(paragraphs).slice(0, 24);
}
function dedupeBullets(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = item.toLowerCase().slice(0, 80);
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}
/** Structured view of a resume for matching against a job description. */
export function parseResumeProfile(text) {
    const sections = splitResumeSections(text);
    const skillsText = sections.skills ?? '';
    const experienceText = sections.experience ?? '';
    const projectsText = sections.projects ?? '';
    const summaryText = sections.summary ?? '';
    const fallbackBody = sections.body ?? text;
    const experienceBullets = extractResumeBullets(experienceText || fallbackBody);
    const projectBullets = extractResumeBullets(projectsText);
    const bullets = dedupeBullets([...experienceBullets, ...projectBullets]);
    return {
        skillsText,
        experienceText: experienceText || fallbackBody,
        projectsText,
        summaryText,
        bullets,
        experienceBullets,
        projectBullets,
    };
}
