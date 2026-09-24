/**
 * Single entrypoint for SharePoint / legacy migration ops.
 *
 *   npm run db:legacy -- <command> [flags...]
 *
 * Commands:
 *   import                 Full CSV + resume import
 *   import-xlsx            Main Data.xlsx + Resume_Repository (local defaults)
 *   report                 Excel report from CSV/manifest (no DB writes)
 *   resume-skills          Fill primary/secondary skills from parsed resumes
 *   requirement-skills     Rebuild requirement primary/secondary skills from skills text + JD
 *   match-scores           Recompute stored job match % for linked candidates
 *   export-sql             SQL file + resume files for the hosted DB
 *   verify                 Sample post-import checks
 *   sync-resumes           Push local resumes to remote API
 *   sync-statuses          Re-apply Candidate sheet statuses
 *   sync-interview-feedback
 *   sync-interview-panels
 *   import-ift             Import IFT feedback CSV
 *   import-referrals       Import employee referrals CSV
 *   dedupe-users           Merge duplicate legacy users
 *   prune-recruiters       Keep allowed recruiters; rest → Employee Referral
 *   wipe                   Wipe hiring data, keep users
 *   repair-dates           Repair interview dates from CSV
 *   job-codes              Normalize requirement job codes
 */
import '../config/loadEnv.js';
import { prisma } from '../lib/prisma.js';
const COMMANDS = [
    {
        name: 'import',
        aliases: ['import-data'],
        description: 'Import legacy SharePoint CSV + resumes',
        run: async (argv) => (await import('./legacy/importData.js')).run(argv),
    },
    {
        name: 'import-xlsx',
        aliases: ['import-main-data'],
        description: 'Import Main Data.xlsx + Resume_Repository into local DB',
        run: async (argv) => {
            const mod = await import('./legacy/importData.js');
            return mod.run(mod.applyMainDataDefaults(argv));
        },
    },
    {
        name: 'report',
        description: 'Build Excel migration report (no DB writes)',
        run: async (argv) => (await import('./legacy/report.js')).run(argv),
    },
    {
        name: 'resume-skills',
        description: 'Fill candidate primary/secondary skills from parsed resume text',
        run: async (argv) => (await import('./legacy/resumeSkills.js')).run(argv),
    },
    {
        name: 'requirement-skills',
        description: 'Rebuild requirement primary/secondary skills from skills text + JD',
        run: async (argv) => (await import('./legacy/refreshMatching.js')).runRequirementSkills(argv),
    },
    {
        name: 'match-scores',
        description: 'Recompute stored job match % for linked candidates',
        run: async (argv) => (await import('./legacy/refreshMatching.js')).runMatchScores(argv),
    },
    {
        name: 'export-sql',
        description: 'Write imported hiring data as one SQL file (+ resume files) for the hosted DB',
        run: async (argv) => (await import('./legacy/exportSql.js')).run(argv),
    },
    {
        name: 'verify',
        description: 'Verify sample imported requirements/candidates',
        run: async (argv) => (await import('./legacy/verify.js')).run(argv),
    },
    {
        name: 'sync-resumes',
        description: 'Upload local resume files to a remote API',
        run: async (argv) => (await import('./legacy/syncResumes.js')).run(argv),
    },
    {
        name: 'sync-statuses',
        description: 'Re-apply Candidate sheet Status → ATS pipeline',
        run: async (argv) => (await import('./legacy/syncStatuses.js')).run(argv),
    },
    {
        name: 'sync-interview-feedback',
        description: 'Sync interview feedback from legacy CSV',
        run: async (argv) => (await import('./legacy/syncInterviewFeedback.js')).run(argv),
    },
    {
        name: 'sync-interview-panels',
        description: 'Sync interview panel assignments from legacy data',
        run: async (argv) => (await import('./legacy/syncInterviewPanels.js')).run(argv),
    },
    {
        name: 'import-ift',
        description: 'Import IFT feedback CSV',
        run: async (argv) => (await import('./legacy/importIftFeedback.js')).run(argv),
    },
    {
        name: 'import-referrals',
        description: 'Import employee referral CSV',
        run: async (argv) => (await import('./legacy/importReferrals.js')).run(argv),
    },
    {
        name: 'dedupe-users',
        description: 'Dedupe legacy-created users',
        run: async (argv) => (await import('./legacy/dedupeUsers.js')).run(argv),
    },
    {
        name: 'prune-recruiters',
        description: 'Keep allowed recruiters; remap others to Employee Referral',
        run: async (argv) => (await import('./legacy/pruneRecruiters.js')).run(argv),
    },
    {
        name: 'wipe',
        description: 'Wipe hiring data but keep users',
        run: async (argv) => (await import('./legacy/wipe.js')).run(argv),
    },
    {
        name: 'repair-dates',
        description: 'Repair interview scheduledAt from Candidate/IFT CSV',
        run: async (argv) => (await import('./legacy/repairInterviewDates.js')).run(argv),
    },
    {
        name: 'job-codes',
        description: 'Normalize requirement job codes',
        run: async (argv) => (await import('./legacy/jobCodes.js')).run(argv),
    },
];
function printHelp() {
    console.log(`Usage: npm run db:legacy -- <command> [flags...]

Commands:`);
    for (const cmd of COMMANDS) {
        const alias = cmd.aliases?.length ? ` (alias: ${cmd.aliases.join(', ')})` : '';
        console.log(`  ${cmd.name.padEnd(24)} ${cmd.description}${alias}`);
    }
    console.log(`
Examples:
  npm run db:legacy -- import --data-dir "...\\data" --dry-run
  npm run db:import-main-data -- --dry-run
  npm run db:legacy -- report --data-dir "...\\data"
  npm run db:legacy -- repair-dates --data-dir "...\\data" --dry-run
`);
}
async function main() {
    const argv = process.argv.slice(2);
    const commandName = argv[0];
    if (!commandName || commandName === '--help' || commandName === '-h') {
        printHelp();
        return;
    }
    const cmd = COMMANDS.find((c) => c.name === commandName || c.aliases?.includes(commandName));
    if (!cmd) {
        console.error(`Unknown command: ${commandName}\n`);
        printHelp();
        process.exit(1);
    }
    await cmd.run(argv.slice(1));
}
main()
    .catch((err) => {
    console.error(err);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
});
