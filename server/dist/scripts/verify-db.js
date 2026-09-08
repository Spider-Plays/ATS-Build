import { databaseHostLabel } from '../config/loadEnv.js';
const host = databaseHostLabel();
const envLabel = process.env.ATS_ENV === 'staging' ? 'QA staging (.env.staging)' : 'default (.env)';
console.log(`Checking database [${envLabel}${host ? ` → ${host}` : ''}]`);
const url = process.env.DATABASE_URL ?? '';
if (!url.startsWith('postgresql://')) {
    console.error('DATABASE_URL must be a Neon PostgreSQL URL (same as Render).\n' +
        'Your .env still points at SQLite or is missing — copy the pooled string from Neon Console → Connect.');
    process.exit(1);
}
const { prisma } = await import('../lib/prisma.js');
try {
    const count = await prisma.user.count();
    console.log(`Connected to Neon. User table has ${count} row(s).`);
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
