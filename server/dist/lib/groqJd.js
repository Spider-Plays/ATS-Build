import { groqChatCompletion, isGroqConfigured } from './assistant/groqClient.js';
import { prisma } from './prisma.js';
import { invalidateSkillCatalogCache } from './skillCatalog.js';
function parseJsonObject(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fenced?.[1]?.trim() || trimmed;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    try {
        return JSON.parse(raw.slice(start, end + 1));
    }
    catch {
        return null;
    }
}
function asStringList(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const name = item.trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > 80)
            continue;
        const key = name.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(name);
    }
    return out.slice(0, 12);
}
export async function generateJobDescriptionWithGroq(input) {
    if (!isGroqConfigured())
        return null;
    const message = await groqChatCompletion({
        temperature: 0.4,
        messages: [
            {
                role: 'system',
                content: 'You write hiring job descriptions. Return only the job description as plain text with short paragraphs and bullet lines starting with "- ". No JSON, no markdown fences.',
            },
            {
                role: 'user',
                content: JSON.stringify({
                    title: input.title,
                    seniority: input.seniorityLevel,
                    experienceMinYears: input.experienceMinYears,
                    experienceMaxYears: input.experienceMaxYears,
                    department: input.department,
                    client: input.client,
                    primarySkills: input.primarySkills,
                    secondarySkills: input.secondarySkills ?? [],
                }),
            },
        ],
    });
    const text = (message.content ?? '').trim();
    return text.length >= 20 ? text : null;
}
async function ensureCatalogSkills(names) {
    const resolved = [];
    for (const name of names) {
        const existing = await prisma.skillCatalog.findFirst({
            where: { name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) {
            resolved.push(existing.name);
            continue;
        }
        const row = await prisma.skillCatalog.create({
            data: { name, category: 'General' },
        });
        resolved.push(row.name);
    }
    if (names.length)
        invalidateSkillCatalogCache();
    return resolved;
}
/** Extract primary and secondary skills with Groq. Missing catalog names are added. */
export async function extractSkillsWithGroq(jobDescription) {
    if (!isGroqConfigured())
        return null;
    const message = await groqChatCompletion({
        temperature: 0.1,
        messages: [
            {
                role: 'system',
                content: 'Extract technical and professional skills from a job description. Reply with JSON only: {"primarySkills": string[], "secondarySkills": string[]}. Primary skills are required skills. Secondary skills are nice-to-have. Use short skill names, not sentences. No more than 8 in each list.',
            },
            { role: 'user', content: jobDescription.slice(0, 12_000) },
        ],
    });
    const parsed = parseJsonObject(message.content ?? '');
    if (!parsed)
        return null;
    const primary = await ensureCatalogSkills(asStringList(parsed.primarySkills));
    const primarySet = new Set(primary.map((s) => s.toLowerCase()));
    const secondary = (await ensureCatalogSkills(asStringList(parsed.secondarySkills))).filter((s) => !primarySet.has(s.toLowerCase()));
    return { primarySkills: primary, secondarySkills: secondary };
}
