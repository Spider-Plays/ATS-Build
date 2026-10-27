/**
 * Rebuild requirement skills and stored candidate match scores after an import.
 *
 *   npm run db:legacy -- requirement-skills [--dry-run] [--sample 5]
 *   npm run db:legacy -- match-scores [--dry-run]
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { getCatalogSkillNames, listSkillCatalog } from '../../lib/skillCatalog.js';
import { deriveRequirementSkills, deserializeSkills, serializeSkills } from '../../lib/skills.js';
import { computeMatchScore } from '../../lib/profileMatching.js';
function flags(argv) {
    const i = argv.indexOf('--sample');
    const sample = i >= 0 ? Number(argv[i + 1]) : 5;
    return { dryRun: argv.includes('--dry-run'), sample: Number.isFinite(sample) && sample >= 0 ? sample : 5 };
}
/** Primary = skills named in the requirement's skills text (MRF "Desired / Primary skill"); secondary = other JD skills. */
export async function runRequirementSkills(argv = []) {
    const { dryRun, sample } = flags(argv);
    const catalog = await listSkillCatalog();
    const requirements = await prisma.requirement.findMany({
        select: { id: true, jobCode: true, title: true, primarySkills: true, secondarySkills: true, jobDescription: true, description: true },
    });
    let changed = 0;
    let shown = 0;
    let empty = 0;
    for (const r of requirements) {
        const skillsText = deserializeSkills(r.primarySkills).join(', ');
        const jd = r.jobDescription?.trim() || r.description?.trim() || '';
        const { primary, secondary } = deriveRequirementSkills(skillsText, jd, catalog);
        if (!primary.length && !secondary.length)
            empty++;
        const primarySkills = serializeSkills(primary);
        const secondarySkills = serializeSkills(secondary);
        if (primarySkills === r.primarySkills && secondarySkills === r.secondarySkills)
            continue;
        changed++;
        if (shown < sample) {
            shown++;
            console.log(`  ${r.jobCode} ${r.title}\n    was:       ${deserializeSkills(r.primarySkills).join(' | ')}\n    primary:   ${primary.join(', ')}\n    secondary: ${secondary.join(', ')}`);
        }
        if (!dryRun)
            await prisma.requirement.update({ where: { id: r.id }, data: { primarySkills, secondarySkills } });
    }
    console.log(`${dryRun ? '[dry-run] would update' : 'Updated'} ${changed} of ${requirements.length} requirement(s); ` +
        `${empty} have no skills in their skills text or JD.`);
}
/** Recompute the stored match % for every candidate linked to a requirement. */
export async function runMatchScores(argv = []) {
    const { dryRun } = flags(argv);
    const catalog = await getCatalogSkillNames();
    const requirements = new Map((await prisma.requirement.findMany()).map((r) => [r.id, r]));
    const candidates = await prisma.candidate.findMany({ where: { requirementId: { not: null } } });
    const buckets = { 'not enough data': 0, '0': 0, '1-24': 0, '25-49': 0, '50-74': 0, '75-100': 0 };
    let changed = 0;
    for (const c of candidates) {
        const requirement = requirements.get(c.requirementId);
        if (!requirement)
            continue;
        const { score } = computeMatchScore(c, requirement, c.resumeText ?? '', catalog);
        const bucket = score < 0 ? 'not enough data' : score === 0 ? '0' : score < 25 ? '1-24' : score < 50 ? '25-49' : score < 75 ? '50-74' : '75-100';
        buckets[bucket]++;
        if (Math.round(c.matchScore) === score)
            continue;
        changed++;
        if (!dryRun)
            await prisma.candidate.update({ where: { id: c.id }, data: { matchScore: score } });
    }
    console.log(`${dryRun ? '[dry-run] would update' : 'Updated'} ${changed} of ${candidates.length} linked candidate(s).`);
    console.log('Match % distribution:', buckets);
}
