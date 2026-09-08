/**
 * Parse free-text experience / CTC / notice into numeric helpers for range facets,
 * and build the full-text search corpus from existing candidate fields.
 */
function parseSkillJson(raw) {
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
export function parseExperienceYears(raw) {
    if (!raw?.trim())
        return null;
    const s = raw.trim();
    const match = s.match(/(\d+(?:\.\d+)?)\s*\+?\s*(years?|yrs?)?/i);
    if (!match) {
        const bare = s.match(/^(\d+(?:\.\d+)?)$/);
        if (!bare)
            return null;
        const n = Number(bare[1]);
        return Number.isFinite(n) ? n : null;
    }
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
}
/** Returns CTC in lakhs (e.g. "18 LPA" → 18). */
export function parseCtcLakhs(raw) {
    if (!raw?.trim())
        return null;
    const s = raw.trim();
    const match = s.match(/(\d+(?:\.\d+)?)/);
    if (!match)
        return null;
    const num = Number(match[1]);
    if (!Number.isFinite(num))
        return null;
    if (/cr|crore/i.test(s))
        return Math.round(num * 100 * 100) / 100; // crore → lakhs
    if (/lpa|lac|lakh/i.test(s))
        return num;
    // Raw annual INR
    if (num > 1000)
        return Math.round((num / 100_000) * 100) / 100;
    // Assume already in lakhs when small
    return num;
}
export function parseNoticeDays(raw) {
    if (!raw?.trim())
        return null;
    const s = raw.trim();
    if (/immediate|serving|negotiable/i.test(s) && !/\d/.test(s)) {
        if (/immediate/i.test(s))
            return 0;
        return null;
    }
    const daysMatch = s.match(/(\d+)\s*(days?|d\b)/i);
    if (daysMatch) {
        const n = Number(daysMatch[1]);
        return Number.isFinite(n) ? n : null;
    }
    const monthsMatch = s.match(/(\d+)\s*(months?|mos?)/i);
    if (monthsMatch) {
        const n = Number(monthsMatch[1]);
        return Number.isFinite(n) ? n * 30 : null;
    }
    const bare = s.match(/^(\d+)$/);
    if (bare) {
        const n = Number(bare[1]);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
/** Weighted corpus: important fields repeated so `to_tsvector` ranks them higher. */
export function buildSearchText(fields) {
    const skills = [
        ...parseSkillJson(fields.primarySkills),
        ...parseSkillJson(fields.secondarySkills),
    ].join(' ');
    const parts = [];
    const pushWeighted = (value, weight) => {
        const t = value?.trim();
        if (!t)
            return;
        for (let i = 0; i < weight; i++)
            parts.push(t);
    };
    pushWeighted(fields.name, 3);
    pushWeighted(fields.email, 2);
    pushWeighted(fields.role, 3);
    pushWeighted(fields.jobTitle, 2);
    pushWeighted(skills, 3);
    pushWeighted(fields.location, 2);
    pushWeighted(fields.currentCompany, 2);
    pushWeighted(fields.totalExperience, 1);
    pushWeighted(fields.currentCTC, 1);
    pushWeighted(fields.expectedCTC, 1);
    pushWeighted(fields.noticePeriod, 1);
    // Resume once (lower weight)
    if (fields.resumeText?.trim()) {
        const clipped = fields.resumeText.trim().slice(0, 80_000);
        parts.push(clipped);
    }
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    return text || null;
}
export function buildCandidateSearchIndexFields(fields) {
    return {
        experienceYears: parseExperienceYears(fields.totalExperience),
        currentCtcLakhs: parseCtcLakhs(fields.currentCTC),
        expectedCtcLakhs: parseCtcLakhs(fields.expectedCTC),
        noticePeriodDays: parseNoticeDays(fields.noticePeriod),
        searchText: buildSearchText(fields),
    };
}
