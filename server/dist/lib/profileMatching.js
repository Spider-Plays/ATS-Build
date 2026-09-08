import { parseJobProfile } from './jdAnalysis.js';
import { parseResumeProfile } from './resumeAnalysis.js';
import { deserializeSkills, extractSkillsFromText, normalizeSkillToken } from './skills.js';
import { extractResumeText } from './resumeParse.js';
import { loadCandidateResume } from './candidateResume.js';
const STOP_WORDS = new Set([
    'about',
    'after',
    'also',
    'and',
    'are',
    'been',
    'being',
    'both',
    'but',
    'can',
    'for',
    'from',
    'have',
    'into',
    'more',
    'must',
    'not',
    'our',
    'that',
    'the',
    'their',
    'them',
    'they',
    'this',
    'through',
    'using',
    'with',
    'will',
    'work',
    'your',
    'role',
    'team',
    'years',
    'year',
    'experience',
    'skills',
    'ability',
    'strong',
    'good',
    'hands',
    'production',
    'professional',
    'required',
    'preferred',
    'looking',
    'seeking',
    'hiring',
]);
function tokenize(text) {
    const tokens = new Set();
    for (const word of text
        .toLowerCase()
        .replace(/[^a-z0-9+#.\s-]/g, ' ')
        .split(/\s+/)) {
        const w = word.replace(/^-+|-+$/g, '');
        if (w.length >= 3 && w.length <= 24 && !STOP_WORDS.has(w))
            tokens.add(w);
    }
    return tokens;
}
function jaccard(a, b) {
    if (!a.size || !b.size)
        return 0;
    let intersection = 0;
    for (const token of a) {
        if (b.has(token))
            intersection++;
    }
    const union = a.size + b.size - intersection;
    return union > 0 ? intersection / union : 0;
}
function corpusContainsSkill(corpus, skill) {
    const token = normalizeSkillToken(skill);
    if (!token || token.length < 2)
        return false;
    if (corpus.includes(token))
        return true;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i').test(corpus);
}
function scoreSkillList(required, corpora) {
    if (!required.length)
        return { score: 1, matched: [] };
    const matched = [];
    for (const skill of required) {
        if (corpora.some((corpus) => corpusContainsSkill(corpus, skill))) {
            matched.push(skill);
        }
    }
    return { score: matched.length / required.length, matched };
}
function bestBulletMatchScore(requirementBullets, resumeBullets) {
    if (!requirementBullets.length || !resumeBullets.length)
        return 0;
    let total = 0;
    for (const requirementBullet of requirementBullets) {
        const reqTokens = tokenize(requirementBullet);
        let best = 0;
        for (const resumeBullet of resumeBullets) {
            best = Math.max(best, jaccard(reqTokens, tokenize(resumeBullet)));
        }
        total += best;
    }
    return total / requirementBullets.length;
}
function scoreNarrativeOverlap(requirementText, resumeText) {
    if (!requirementText.trim() || !resumeText.trim())
        return 0;
    const reqTokens = tokenize(requirementText);
    const resumeTokens = tokenize(resumeText);
    if (!reqTokens.size)
        return 0;
    let hits = 0;
    for (const token of reqTokens) {
        if (resumeTokens.has(token))
            hits++;
    }
    return hits / reqTokens.size;
}
function topMatchingHighlights(requirementBullets, resumeBullets, limit = 3) {
    if (!requirementBullets.length || !resumeBullets.length)
        return [];
    const scored = resumeBullets.map((resumeBullet) => {
        const resumeTokens = tokenize(resumeBullet);
        let best = 0;
        for (const requirementBullet of requirementBullets) {
            best = Math.max(best, jaccard(resumeTokens, tokenize(requirementBullet)));
        }
        return { resumeBullet, best };
    });
    return scored
        .filter((row) => row.best >= 0.18)
        .sort((a, b) => b.best - a.best)
        .slice(0, limit)
        .map((row) => row.resumeBullet.slice(0, 140));
}
function buildSummary(breakdown, hasResume) {
    if (!hasResume)
        return 'Add a resume to score project and JD alignment.';
    const parts = [];
    if (breakdown.matchedPrimary.length > 0) {
        parts.push(`${breakdown.matchedPrimary.length} primary skill${breakdown.matchedPrimary.length === 1 ? '' : 's'} found in resume`);
    }
    if (breakdown.projectScore >= 55) {
        parts.push('project experience aligns with role responsibilities');
    }
    else if (breakdown.projectScore >= 30) {
        parts.push('some project overlap with the JD');
    }
    if (breakdown.jdScore >= 55) {
        parts.push('resume narrative matches the job description');
    }
    if (parts.length === 0) {
        return 'Limited overlap between resume and this job description.';
    }
    return parts.join('; ').replace(/^./, (c) => c.toUpperCase()) + '.';
}
export function computeMatchScore(candidate, requirement, resumeText, catalogNames = []) {
    const profilePrimary = deserializeSkills(candidate.primarySkills);
    const profileSecondary = deserializeSkills(candidate.secondarySkills);
    const resumeProfile = parseResumeProfile(resumeText);
    const extractedResumeSkills = extractSkillsFromText(resumeText, catalogNames);
    const resumeSkillCorpus = [
        resumeProfile.skillsText,
        extractedResumeSkills.join(' '),
        profilePrimary.join(' '),
        profileSecondary.join(' '),
    ].join(' ');
    const fullResumeCorpus = [
        resumeText,
        candidate.role,
        candidate.currentCompany ?? '',
        candidate.totalExperience ?? '',
        ...profilePrimary,
        ...profileSecondary,
        ...extractedResumeSkills,
    ]
        .join(' ')
        .toLowerCase();
    const reqPrimary = deserializeSkills(requirement.primarySkills);
    const reqSecondary = deserializeSkills(requirement.secondarySkills);
    const jd = requirement.jobDescription?.trim() ||
        requirement.description?.trim() ||
        '';
    const jobProfile = parseJobProfile(jd);
    const jdRequirementBullets = [
        ...jobProfile.responsibilityBullets,
        ...jobProfile.mustHaveBullets,
    ];
    const resumeBullets = resumeProfile.bullets.length
        ? resumeProfile.bullets
        : extractResumeBulletsFallback(resumeText);
    const primary = scoreSkillList(reqPrimary, [resumeSkillCorpus, fullResumeCorpus]);
    const secondary = scoreSkillList(reqSecondary, [resumeSkillCorpus, fullResumeCorpus]);
    const projectScoreRaw = bestBulletMatchScore(jdRequirementBullets, resumeBullets);
    const narrativeScoreRaw = scoreNarrativeOverlap([jobProfile.aboutText, jobProfile.responsibilitiesText, jobProfile.mustHaveText, jd].join('\n'), [resumeProfile.summaryText, resumeProfile.experienceText, resumeProfile.projectsText, resumeText].join('\n'));
    const jdScoreRaw = jdRequirementBullets.length
        ? projectScoreRaw * 0.65 + narrativeScoreRaw * 0.35
        : narrativeScoreRaw;
    const hasPrimary = reqPrimary.length > 0;
    const hasSecondary = reqSecondary.length > 0;
    const hasJd = jd.length > 0;
    const hasResume = resumeText.trim().length > 0;
    let score;
    if (!hasPrimary && !hasSecondary && !hasJd) {
        score = 0;
    }
    else if (!hasPrimary && !hasSecondary) {
        score = jdScoreRaw;
    }
    else if (!hasJd) {
        const wPrimary = hasPrimary ? 0.65 : 0;
        const wSecondary = hasSecondary ? 0.35 : 0;
        score = (primary.score * wPrimary + secondary.score * wSecondary) / (wPrimary + wSecondary);
    }
    else if (!hasResume) {
        const wPrimary = hasPrimary ? 0.55 : 0;
        const wSecondary = hasSecondary ? 0.25 : 0;
        const wJd = 0.2;
        const skillWeight = wPrimary + wSecondary;
        const skillPart = skillWeight > 0
            ? (primary.score * wPrimary + secondary.score * wSecondary) / skillWeight
            : 0;
        score = skillPart * skillWeight + jdScoreRaw * wJd;
    }
    else {
        const wPrimary = hasPrimary ? 0.3 : 0;
        const wSecondary = hasSecondary ? 0.15 : 0;
        const wJd = 0.3;
        const wProject = 0.25;
        const skillWeight = wPrimary + wSecondary;
        const skillPart = skillWeight > 0
            ? (primary.score * wPrimary + secondary.score * wSecondary) / skillWeight
            : 0;
        score =
            skillPart * skillWeight +
                jdScoreRaw * wJd +
                projectScoreRaw * wProject;
    }
    const matchedHighlights = topMatchingHighlights(jdRequirementBullets, resumeBullets);
    const breakdownBase = {
        primaryScore: Math.round(primary.score * 100),
        secondaryScore: Math.round(secondary.score * 100),
        jdScore: Math.round(jdScoreRaw * 100),
        projectScore: Math.round(projectScoreRaw * 100),
        resumeScore: Math.round(narrativeScoreRaw * 100),
        matchedPrimary: primary.matched,
        matchedSecondary: secondary.matched,
        matchedHighlights,
    };
    const breakdown = {
        ...breakdownBase,
        summary: buildSummary(breakdownBase, hasResume),
    };
    return {
        score: Math.round(Math.min(100, Math.max(0, score * 100))),
        breakdown,
    };
}
function extractResumeBulletsFallback(text) {
    return text
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter((p) => p.length >= 30 && p.length <= 500)
        .slice(0, 16);
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
