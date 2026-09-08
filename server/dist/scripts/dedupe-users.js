import { prisma } from '../lib/prisma.js';
import { removeLegacyDevUsers } from '../lib/legacyDevUsers.js';
async function main() {
    const result = await removeLegacyDevUsers(prisma);
    const total = await prisma.user.count();
    console.log('Legacy user cleanup complete:');
    console.log(`  Merged dev-* accounts into canonical emails: ${result.merged}`);
    console.log(`  Deleted duplicate dev-* accounts: ${result.deleted}`);
    console.log(`  Deleted other legacy-pattern accounts: ${result.patternDeleted}`);
    console.log(`  Users remaining: ${total}`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
