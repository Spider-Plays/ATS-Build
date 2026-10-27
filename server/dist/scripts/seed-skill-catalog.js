/**
 * Seed the full IT skill catalog from server/src/config/defaultSkills.ts
 *
 * Usage:
 *   $env:ATS_ENV='staging'
 *   npm run db:seed-skills --prefix server
 */
import '../config/loadEnv.js';
import { prisma } from '../lib/prisma.js';
import { databaseHostLabel } from '../config/loadEnv.js';
import { DEFAULT_SKILL_CATALOG } from '../config/defaultSkills.js';
import { syncDefaultSkillCatalog } from '../lib/skillCatalog.js';
async function main() {
    const host = databaseHostLabel();
    if (!host?.includes('localhost') && !host?.includes('127.0.0.1')) {
        console.error(`Refusing to seed skills on non-local database (${host ?? 'unknown'}).`);
        process.exit(1);
    }
    console.log(`Seeding IT skill catalog on ${host ?? '(unknown)'}...`);
    console.log(`Default catalog size: ${DEFAULT_SKILL_CATALOG.length} skills`);
    const added = await syncDefaultSkillCatalog();
    const total = await prisma.skillCatalog.count();
    console.log(`\nSkill catalog ready.`);
    console.log(`  Added: ${added}`);
    console.log(`  Total in database: ${total}`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
