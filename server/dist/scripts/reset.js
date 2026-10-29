/**
 * Single entrypoint for destructive DB reset / clear ops.
 *
 *   npm run db:reset -- <command> [flags...]
 *
 * Commands:
 *   all                Clear entire database
 *   demo               Clear demo/mock data (keep real QA users + catalogs)
 *   keep-users         Wipe hiring data, keep all users
 *   keep-admin    Keep one ADMIN only
 */
import '../config/loadEnv.js';
import { prisma } from '../lib/prisma.js';
const COMMANDS = [
    {
        name: 'all',
        aliases: ['clear'],
        description: 'Clear entire database (all tables empty)',
        run: async (argv) => (await import('./reset/clearAll.js')).run(argv),
    },
    {
        name: 'demo',
        aliases: ['clear-demo'],
        description: 'Clear demo data; keep real QA users + catalogs',
        run: async (argv) => (await import('./reset/clearDemo.js')).run(argv),
    },
    {
        name: 'keep-users',
        aliases: ['wipe'],
        description: 'Wipe hiring data but keep all users',
        run: async (argv) => (await import('./reset/keepUsers.js')).run(argv),
    },
    {
        name: 'keep-admin',
        description: 'Keep one ADMIN; delete everything else',
        run: async (argv) => (await import('./reset/keepAdmin.js')).run(argv),
    },
];
function printHelp() {
    console.log(`Usage: npm run db:reset -- <command> [flags...]

Commands:`);
    for (const cmd of COMMANDS) {
        const alias = cmd.aliases?.length ? ` (alias: ${cmd.aliases.join(', ')})` : '';
        console.log(`  ${cmd.name.padEnd(20)} ${cmd.description}${alias}`);
    }
    console.log(`
Env confirms (required for most commands):
  all                 staging isolation (no CONFIRM_*)
  demo                CONFIRM_DEMO_CLEAR=yes
  keep-users          CONFIRM_WIPE_KEEP_USERS=yes
  keep-admin     CONFIRM_PRODUCTION_RESET=yes

Examples:
  npm run db:reset -- all
  $env:CONFIRM_DEMO_CLEAR='yes'; npm run db:reset -- demo
  $env:CONFIRM_WIPE_KEEP_USERS='yes'; npm run db:reset -- keep-users
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
