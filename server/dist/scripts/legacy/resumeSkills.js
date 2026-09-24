/**
 * Fill candidate primary / secondary skills from their parsed resume text.
 *
 *   npm run db:legacy -- resume-skills --xlsx "../migrations/Main Data (1).xlsx" [--dry-run] [--sample 10]
 *
 * Sheet (recruiter-entered) skills stay first; catalog skills found in the resume are added,
 * most-mentioned first. Candidates without resume text are left unchanged.
 */
import '../../config/loadEnv.js';
import { prisma } from '../../lib/prisma.js';
import { ensureDefaultSkillCatalog } from '../../lib/skillCatalog.js';
import { mergeResumeSkills, parseSkillList, rankSkillsInText, serializeSkills } from '../../lib/skills.js';
import { buildCandidateSearchIndexFields } from '../../lib/candidateFieldNormalize.js';
import { loadLegacyXlsx } from '../../lib/legacyImport/loadXlsx.js';
import { rowGet } from '../../lib/legacyImport/parseCsv.js';
function parseArgs(argv) {
    let dryRun = false;
    let sample = 5;
    let xlsxPath = '';
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dry-run')
            dryRun = true;
        else if (argv[i] === '--sample') {
            const n = Number(argv[++i]);
            if (Number.isFinite(n) && n >= 0)
                sample = n;
        }
        else if (argv[i] === '--xlsx')
            xlsxPath = argv[++i] ?? '';
    }
    return { dryRun, sample, xlsxPath };
}
/** RESUME ID → recruiter-entered skills from the candidate sheet (the clean base to merge onto). */
async function loadSheetSkills(xlsxPath) {
    const map = new Map();
    if (!xlsxPath)
        return map;
    for (const row of await loadLegacyXlsx(xlsxPath)) {
        const id = rowGet(row, 'RESUME ID');
        if (!id)
            continue;
        map.set(id, {
            primary: parseSkillList(rowGet(row, 'Primary Skill')),
            secondary: parseSkillList(rowGet(row, 'Secondary Skill')),
        });
    }
    return map;
}
export async function run(argv = []) {
    const { dryRun, sample, xlsxPath } = parseArgs(argv);
    const sheetSkills = await loadSheetSkills(xlsxPath);
    if (!xlsxPath)
        console.log('No --xlsx given: merging onto the skills already stored on each candidate.');
    await ensureDefaultSkillCatalog();
    const catalog = await prisma.skillCatalog.findMany({
        select: { name: true, category: true },
        orderBy: { name: 'asc' },
    });
    const candidates = await prisma.candidate.findMany({
        where: { resumeText: { not: null } },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            jobTitle: true,
            location: true,
            currentCompany: true,
            resumeText: true,
            primarySkills: true,
            secondarySkills: true,
            totalExperience: true,
            currentCTC: true,
            expectedCTC: true,
            noticePeriod: true,
            legacyResumeId: true,
        },
    });
    console.log(`${dryRun ? '[dry-run] ' : ''}Resume skills for ${candidates.length} candidate(s) with resume text`);
    let updated = 0;
    let noSkillsFound = 0;
    let totalPrimary = 0;
    let totalSecondary = 0;
    for (const c of candidates) {
        const ranked = rankSkillsInText(c.resumeText ?? '', catalog);
        if (ranked.length === 0)
            noSkillsFound++;
        const sheet = c.legacyResumeId ? sheetSkills.get(c.legacyResumeId) : undefined;
        const merged = mergeResumeSkills(sheet?.primary ?? parseSkillList(c.primarySkills), sheet?.secondary ?? parseSkillList(c.secondarySkills), ranked);
        const primarySkills = serializeSkills(merged.primary);
        const secondarySkills = serializeSkills(merged.secondary);
        totalPrimary += merged.primary.length;
        totalSecondary += merged.secondary.length;
        if (updated < sample) {
            console.log(`  ${c.name}\n    primary:   ${merged.primary.join(', ')}\n    secondary: ${merged.secondary.join(', ')}`);
        }
        if (primarySkills === c.primarySkills && secondarySkills === c.secondarySkills)
            continue;
        updated++;
        if (dryRun)
            continue;
        await prisma.candidate.update({
            where: { id: c.id },
            data: {
                primarySkills,
                secondarySkills,
                ...buildCandidateSearchIndexFields({ ...c, primarySkills, secondarySkills }),
            },
        });
    }
    const n = Math.max(candidates.length, 1);
    console.log(`${dryRun ? '[dry-run] would update' : 'Updated'} ${updated} candidate(s); ` +
        `avg ${(totalPrimary / n).toFixed(1)} primary / ${(totalSecondary / n).toFixed(1)} secondary; ` +
        `${noSkillsFound} resume(s) had no catalog skills.`);
}
