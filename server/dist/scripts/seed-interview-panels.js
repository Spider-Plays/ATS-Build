/**
 * Configure L1 / L2 / HR interview panels with active staff members.
 *
 * Usage:
 *   npx tsx src/scripts/seed-interview-panels.ts
 *   npx tsx src/scripts/seed-interview-panels.ts --force
 */
import '../config/loadEnv.js';
import { prisma } from '../lib/prisma.js';
import { configureDefaultInterviewPanels } from '../lib/interviewPanelCatalog.js';
import { devUserEmail } from '../config/devUsers.js';
const FORCE = process.argv.includes('--force');
async function main() {
    const levels = await configureDefaultInterviewPanels({
        force: FORCE,
        perPanel: 3,
        preferredEmailsByOrder: {
            0: [
                devUserEmail('INTERVIEWER'),
                'nisha.kamath@stitch-ats.in',
                'pradeep.naidu@stitch-ats.in',
                devUserEmail('TEAM_LEAD'),
            ],
            1: [
                devUserEmail('HIRING_MANAGER'),
                'preeti.gowda@stitch-ats.in',
                'harish.kulkarni@stitch-ats.in',
                devUserEmail('ACCOUNT_MANAGER'),
            ],
            2: [
                devUserEmail('HR_MANAGER'),
                'gautam.mehta@stitch-ats.in',
                'shalini.verma@stitch-ats.in',
                devUserEmail('HR_HEAD'),
            ],
        },
    });
    const users = await prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    console.log('Interview panels configured:');
    for (const level of levels) {
        const names = level.interviewerIds.map((id) => nameById.get(id) ?? id).join(', ');
        console.log(`  ${level.name} (${level.interviewerIds.length}): ${names || '—'}`);
    }
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
