const SECTION_PATTERN = /(?:^|\n)\s*(?:about\s+(?:the\s+)?role|role\s+summary|responsibilities|what\s+you(?:'ll|\s+will)\s+do|key\s+responsibilities|must\s+have|required\s+qualifications?|requirements|good\s+to\s+have|nice\s+to\s+have|preferred\s+qualifications?|bonus\s+skills?|desired\s+skills?)\s*[:\-]?\s*\n/gim;
const BULLET_LINE = /^\s*(?:[•\-–*]|\d+[.)])\s+(.+)$/;
function extractBullets(text) {
    if (!text.trim())
        return [];
    const bullets = [];
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
        const match = line.match(BULLET_LINE);
        if (match?.[1] && match[1].length >= 8)
            bullets.push(match[1].trim());
    }
    if (bullets.length > 0)
        return bullets.slice(0, 20);
    return text
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter((p) => p.length >= 20 && p.length <= 400)
        .slice(0, 12);
}
/** Split a job description into sections and bullet lists for matching. */
export function parseJobProfile(text) {
    const fullText = text.trim();
    const sections = {};
    if (!fullText) {
        return {
            aboutText: '',
            responsibilitiesText: '',
            mustHaveText: '',
            goodToHaveText: '',
            responsibilityBullets: [],
            mustHaveBullets: [],
            goodToHaveBullets: [],
            fullText: '',
        };
    }
    const matches = [...fullText.matchAll(SECTION_PATTERN)];
    if (matches.length === 0) {
        sections.body = fullText;
    }
    else {
        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const header = match[0].trim().toLowerCase();
            const start = (match.index ?? 0) + match[0].length;
            const end = i + 1 < matches.length ? matches[i + 1].index ?? fullText.length : fullText.length;
            const body = fullText.slice(start, end).trim();
            if (!body)
                continue;
            if (/about|summary/.test(header))
                sections.about = body;
            else if (/responsibilit|what you/.test(header))
                sections.responsibilities = body;
            else if (/must have|required|requirements/.test(header))
                sections.mustHave = body;
            else if (/good to have|nice to have|preferred|bonus|desired/.test(header))
                sections.goodToHave = body;
            else
                sections.body = body;
        }
    }
    const responsibilitiesText = sections.responsibilities ?? sections.body ?? fullText;
    const mustHaveText = sections.mustHave ?? '';
    const goodToHaveText = sections.goodToHave ?? '';
    const aboutText = sections.about ?? '';
    const responsibilityBullets = extractBullets(responsibilitiesText);
    const mustHaveBullets = extractBullets(mustHaveText);
    const goodToHaveBullets = extractBullets(goodToHaveText);
    return {
        aboutText,
        responsibilitiesText,
        mustHaveText,
        goodToHaveText,
        responsibilityBullets,
        mustHaveBullets,
        goodToHaveBullets,
        fullText,
    };
}
