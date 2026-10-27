import { groqChatCompletion, isGroqConfigured } from './assistant/groqClient.js';
import { deserializeSkills } from './skills.js';
const MAX_RESUME_CHARS = 14_000;
const MAX_JD_CHARS = 8_000;
function clip(text, max) {
    const trimmed = text.trim();
    if (trimmed.length <= max)
        return trimmed;
    return `${trimmed.slice(0, max)}\n[truncated]`;
}
function requirementDocument(requirement) {
    const primary = deserializeSkills(requirement.primarySkills);
    const secondary = deserializeSkills(requirement.secondarySkills);
    const lines = [
        `Title: ${requirement.title}`,
        requirement.jobCode ? `Job code: ${requirement.jobCode}` : '',
        requirement.client ? `Client: ${requirement.client}` : '',
        requirement.location ? `Location: ${requirement.location}` : '',
        requirement.experienceMinYears != null || requirement.experienceMaxYears != null
            ? `Experience: ${requirement.experienceMinYears ?? '?'}–${requirement.experienceMaxYears ?? '+'} years`
            : '',
        primary.length ? `Primary skills listed: ${primary.join(', ')}` : '',
        secondary.length ? `Secondary skills listed: ${secondary.join(', ')}` : '',
        '',
        'Job description:',
        requirement.jobDescription?.trim() || requirement.description?.trim() || '(none)',
    ];
    return clip(lines.filter((line) => line !== '').join('\n'), MAX_JD_CHARS);
}
function clampScore(value, fallback) {
    const raw = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(raw))
        return fallback;
    return Math.round(Math.min(100, Math.max(0, raw)));
}
function stringList(value, allowed) {
    if (!Array.isArray(value))
        return [];
    const allow = new Set(allowed.map((s) => s.toLowerCase()));
    const byLower = new Map(allowed.map((s) => [s.toLowerCase(), s]));
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const canonical = byLower.get(item.trim().toLowerCase());
        if (canonical && allow.has(canonical.toLowerCase()) && !out.includes(canonical))
            out.push(canonical);
    }
    return out;
}
function parseAssessment(content, primary, secondary) {
    if (!content?.trim())
        return null;
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    try {
        const parsed = JSON.parse(content.slice(start, end + 1));
        const raw = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score);
        if (!Number.isFinite(raw))
            return null;
        const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
            ? parsed.summary.trim().slice(0, 800)
            : 'Full resume and job description compared.';
        const matchedPrimary = stringList(parsed.matchedPrimary, primary);
        const missingPrimary = stringList(parsed.missingPrimary, primary).filter((s) => !matchedPrimary.includes(s));
        const matchedSecondary = stringList(parsed.matchedSecondary, secondary);
        const missingSecondary = stringList(parsed.missingSecondary, secondary).filter((s) => !matchedSecondary.includes(s));
        return {
            score: clampScore(parsed.score, 0),
            summary,
            primaryScore: primary.length
                ? matchedPrimary.length + missingPrimary.length > 0
                    ? Math.round((matchedPrimary.length / primary.length) * 100)
                    : clampScore(parsed.primaryScore, 0)
                : 0,
            secondaryScore: secondary.length
                ? matchedSecondary.length + missingSecondary.length > 0
                    ? Math.round((matchedSecondary.length / secondary.length) * 100)
                    : clampScore(parsed.secondaryScore, 0)
                : 0,
            experienceScore: parsed.experienceScore == null || parsed.experienceScore === -1
                ? -1
                : clampScore(parsed.experienceScore, -1),
            matchedPrimary,
            missingPrimary,
            matchedSecondary,
            missingSecondary,
        };
    }
    catch {
        return null;
    }
}
/**
 * Holistic resume vs JD score. Returns null when Groq is unset, the call fails,
 * or the model response cannot be parsed — callers keep the skill-coverage score.
 */
export async function assessResumeAgainstJd(input) {
    if (!isGroqConfigured())
        return null;
    const resume = input.resumeText.trim();
    if (resume.length < 80)
        return null;
    const primary = input.primarySkills ?? [];
    const secondary = input.secondarySkills ?? [];
    const profileBits = [
        input.role?.trim() ? `Current role: ${input.role.trim()}` : '',
        input.totalExperience?.trim() ? `Stated experience: ${input.totalExperience.trim()}` : '',
    ]
        .filter(Boolean)
        .join('\n');
    try {
        const message = await groqChatCompletion({
            temperature: 0.1,
            messages: [
                {
                    role: 'system',
                    content: [
                        'You compare a candidate resume to a job description for a recruiting team.',
                        'Read both documents fully. Score fit from responsibilities, domain, tools, seniority, education, and must-haves — not only listed primary and secondary skills.',
                        'A skill mentioned only as a keyword, without supporting work, should not carry the score.',
                        'Also judge each listed primary and secondary skill from the work described, including close equivalents (React.js counts for React, Spring Boot counts for Spring). A skill is missing only when the resume gives no evidence of it.',
                        'Reply with JSON only: {"score": <0-100 overall>, "primaryScore": <0-100 share of primary skills evidenced>, "secondaryScore": <0-100>, "experienceScore": <-1 if the job states no range, else 0-100>, "matchedPrimary": ["exact names from the primary list"], "missingPrimary": ["exact names"], "matchedSecondary": [], "missingSecondary": [], "summary": "<3-5 sentences>"}.',
                    ].join(' '),
                },
                {
                    role: 'user',
                    content: [
                        'JOB',
                        requirementDocument(input.requirement),
                        '',
                        'CANDIDATE',
                        profileBits,
                        primary.length ? `Primary skills to judge: ${primary.join(' | ')}` : '',
                        secondary.length ? `Secondary skills to judge: ${secondary.join(' | ')}` : '',
                        'Resume:',
                        clip(resume, MAX_RESUME_CHARS),
                    ]
                        .filter((part) => part !== '')
                        .join('\n'),
                },
            ],
        });
        return parseAssessment(message.content, primary, secondary);
    }
    catch (err) {
        console.warn('[match] Groq resume/JD assessment failed:', err instanceof Error ? err.message : err);
        return null;
    }
}
