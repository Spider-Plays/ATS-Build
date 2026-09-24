import { databaseHostLabel } from '../config/loadEnv.js';
const host = databaseHostLabel();
const envLabel = 'local PostgreSQL (root .env)';
console.log(`Checking database [${envLabel}${host ? ` → ${host}` : ''}]`);
const url = process.env.DATABASE_URL ?? '';
if (!url.startsWith('postgresql://')) {
    console.error('DATABASE_URL must be a PostgreSQL URL.\n' +
        'Set DATABASE_URL in the root .env to your local PostgreSQL connection string.');
    process.exit(1);
}
const { prisma } = await import('../lib/prisma.js');
try {
    const count = await prisma.user.count();
    console.log(`Connected to PostgreSQL. User table has ${count} row(s).`);
    if (count === 0) {
        console.log('Run: ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... npm run db:bootstrap');
    }
}
catch (e) {
    console.error('Database connection failed:', e);
    process.exit(1);
}
finally {
    await prisma.$disconnect();
}
