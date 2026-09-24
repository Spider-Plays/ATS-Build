import { deserializeSkills, rankSkillsInText, skillMatchPattern } from './skills.js';
import { extractResumeText } from './resumeParse.js';
import { loadCandidateResume } from './candidateResume.js';
import { parseExperienceYears } from './candidateFieldNormalize.js';
/**
 * Job match = weighted coverage of what the requirement asks for:
 *   primary skills 60% · secondary skills 25% · experience fit 15%.
 * A part the requirement doesn't specify is left out and the rest re-weighted,
 * so the percentage is always "share of the stated requirement this candidate meets".
 */
const WEIGHTS = { primary: 0.6, secondary: 0.25, experience: 0.15 };
/**
 * Stored/returned as the match score when a candidate has no readable resume and ≤2 skills:
 * there is too little evidence for a percentage. Sorts below every real score; UIs show "Not enough data".
 */
export const INSUFFICIENT_MATCH_SCORE = -1;
const INSUFFICIENT_MAX_SKILLS = 2;
const patternCache = new Map();
/** Non-global (stateless) whole-word pattern, cached per skill. */
function pattern(skill) {
    const key = skill.toLowerCase();
    let re = patternCache.get(key);
    if (!re) {
        re = new RegExp(skillMatchPattern(skill).source, 'i');
        patternCache.set(key, re);
    }
    return re;
}
const innerSkillCache = new Map();
/** Catalog skills named inside a longer requirement phrase ("Containers (Kubernetes)" → Kubernetes). */
function catalogSkillsInPhrase(skill, catalogNames) {
    const key = `${catalogNames.length}:${skill.toLowerCase()}`;
    let inner = innerSkillCache.get(key);
    if (!inner) {
        const lower = skill.toLowerCase();
        inner = catalogNames.filter((name) => name.length >= 3 && name.toLowerCase() !== lower && pattern(name).test(lower));
        innerSkillCache.set(key, inner);
    }
    return inner;
}
/** A requirement skill is met when it (or every catalog skill named inside it) appears as a whole word. */
function skillIsMet(skill, evidence, catalogNames) {
    if (pattern(skill).test(evidence))
        return true;
    const inner = catalogSkillsInPhrase(skill, catalogNames);
    return inner.length > 0 && inner.every((name) => pattern(name).test(evidence));
}
function scoreSkills(required, evidence, catalogNames) {
    const matched = [];
    const missing = [];
    for (const skill of required)
        (skillIsMet(skill, evidence, catalogNames) ? matched : missing).push(skill);
    return { ratio: required.length ? matched.length / required.length : 0, matched, missing };
}
/** 1 inside the range; loses 20% per year short, 10% per year over (floor 0 / 0.5). */
function experienceFit(years, min, max) {
    if (min != null && years < min)
        return Math.max(0, 1 - (min - years) * 0.2);
    if (max != null && years > max)
        return Math.max(0.5, 1 - (years - max) * 0.1);
    return 1;
}
function requirementSkills(requirement, catalogNames) {
    let primary = deserializeSkills(requirement.primarySkills);
    let secondary = deserializeSkills(requirement.secondarySkills);
    if (!primary.length && !secondary.length) {
        // No skills entered: fall back to the skills the JD names.
        const jd = requirement.jobDescription?.trim() || requirement.description?.trim() || '';
        const ranked = rankSkillsInText(jd, catalogNames);
        primary = ranked.slice(0, 8);
        secondary = ranked.slice(8, 20);
    }
    return { primary, secondary };
}
function buildSummary(primary, secondary, exp) {
    const parts = [];
    const pTotal = primary.matched.length + primary.missing.length;
    const sTotal = secondary.matched.length + secondary.missing.length;
    if (pTotal)
        parts.push(`${primary.matched.length} of ${pTotal} primary skills`);
    if (sTotal)
        parts.push(`${secondary.matched.length} of ${sTotal} secondary skills`);
    if (exp.applies && exp.years != null) {
        const range = exp.min != null && exp.max != null ? `${exp.min}–${exp.max}` : exp.min != null ? `${exp.min}+` : `≤${exp.max}`;
        parts.push(`${exp.years} yrs vs ${range} yrs required`);
    }
    if (!parts.length)
        return 'This requirement lists no skills or experience to match against.';
    const text = `Matches ${parts.join(', ')}.`;
    return primary.missing.length ? `${text} Missing: ${primary.missing.slice(0, 5).join(', ')}.` : text;
}
export function computeMatchScore(candidate, requirement, resumeText, catalogNames = []) {
    const reqSkills = requirementSkills(requirement, catalogNames);
    const candidateSkills = new Set([...deserializeSkills(candidate.primarySkills), ...deserializeSkills(candidate.secondarySkills)].map((s) => s.toLowerCase()));
    if (!resumeText.trim() && candidateSkills.size <= INSUFFICIENT_MAX_SKILLS) {
        return {
            score: INSUFFICIENT_MATCH_SCORE,
            breakdown: {
                insufficientData: true,
                primaryScore: 0,
                secondaryScore: 0,
                experienceScore: -1,
                matchedPrimary: [],
                matchedSecondary: [],
                missingPrimary: [],
                missingSecondary: [],
                summary: 'Not enough data — please update the resume.',
            },
        };
    }
    const evidence = [
        ...deserializeSkills(candidate.primarySkills),
        ...deserializeSkills(candidate.secondarySkills),
        candidate.role,
        candidate.jobTitle ?? '',
        resumeText,
    ]
        .join('\n')
        .toLowerCase();
    const primary = scoreSkills(reqSkills.primary, evidence, catalogNames);
    const secondary = scoreSkills(reqSkills.secondary, evidence, catalogNames);
    const years = candidate.experienceYears ?? parseExperienceYears(candidate.totalExperience);
    const min = requirement.experienceMinYears ?? null;
    // A single figure ("5 years") means "5+", not exactly five.
    const max = requirement.experienceMaxYears != null && requirement.experienceMaxYears !== min ? requirement.experienceMaxYears : null;
    const expApplies = years != null && (min != null || max != null);
    const expRatio = expApplies ? experienceFit(years, min, max) : 0;
    const parts = [];
    if (reqSkills.primary.length)
        parts.push([primary.ratio, WEIGHTS.primary]);
    if (reqSkills.secondary.length)
        parts.push([secondary.ratio, WEIGHTS.secondary]);
    if (expApplies)
        parts.push([expRatio, WEIGHTS.experience]);
    const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
    const score = totalWeight > 0 ? parts.reduce((sum, [r, w]) => sum + r * w, 0) / totalWeight : 0;
    const breakdown = {
        insufficientData: false,
        primaryScore: Math.round(primary.ratio * 100),
        secondaryScore: Math.round(secondary.ratio * 100),
        experienceScore: expApplies ? Math.round(expRatio * 100) : -1,
        matchedPrimary: primary.matched,
        matchedSecondary: secondary.matched,
        missingPrimary: primary.missing,
        missingSecondary: secondary.missing,
        summary: buildSummary(primary, secondary, { years, min, max, applies: expApplies }),
    };
    return { score: Math.round(Math.min(100, Math.max(0, score * 100))), breakdown };
}
export async function loadCandidateResumeText(candidate) {
    if (candidate.resumeText?.trim()) {
        return candidate.resumeText.trim();
    }
    if (!candidate.resumeFileName)
        return '';
    try {
        const loaded = await loadCandidateResume(candidate);
        if (!loaded)
            return '';
        return extractResumeText(loaded.buffer, loaded.mime, loaded.fileName);
    }
    catch {
        return '';
    }
}
export async function computeCandidateRequirementMatch(candidate, requirement, catalogNames = []) {
    const resumeText = await loadCandidateResumeText(candidate);
    return computeMatchScore(candidate, requirement, resumeText, catalogNames);
}
export async function rankCandidatesForRequirement(candidates, requirement, requirementId, catalogNames = []) {
    const results = [];
    for (const candidate of candidates) {
        const resumeText = await loadCandidateResumeText(candidate);
        const { score, breakdown } = computeMatchScore(candidate, requirement, resumeText, catalogNames);
        results.push({
            candidateId: candidate.id,
            matchScore: score,
            breakdown,
            alreadyLinked: candidate.requirementId === requirementId,
            linkedToOther: !!(candidate.requirementId && candidate.requirementId !== requirementId),
        });
    }
    return results.sort((a, b) => b.matchScore - a.matchScore);
}
