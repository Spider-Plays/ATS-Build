import { prisma } from '../lib/prisma.js';
const SAMPLE_VENDORS = [
    {
        name: 'Apex Talent Partners',
        code: 'APEX',
        email: 'contact@apextalent.test',
        phone: '+91 98765 43210',
        contactName: 'Priya Sharma',
        website: 'https://apextalent.example.com',
        status: 'ACTIVE',
        notes: 'Primary IT staffing partner — Bangalore & Hyderabad.',
    },
    {
        name: 'Nexus Recruit Solutions',
        code: 'NEXUS',
        email: 'hello@nexusrecruit.test',
        phone: '+91 91234 56789',
        contactName: 'Rahul Mehta',
        website: 'https://nexusrecruit.example.com',
        status: 'ACTIVE',
        notes: 'Finance and product roles.',
    },
    {
        name: 'Horizon Staffing Co',
        code: 'HORIZON',
        email: 'ops@horizonstaff.test',
        phone: '+91 99887 76655',
        contactName: 'Anita Desai',
        status: 'ACTIVE',
        notes: 'Contract and permanent hiring.',
    },
    {
        name: 'Summit HR Agency',
        code: 'SUMMIT',
        email: 'recruit@summitagency.test',
        contactName: 'Vikram Singh',
        status: 'INACTIVE',
        notes: 'Paused — contract renewal pending.',
    },
    {
        name: 'Dev Staffing Co',
        code: 'DEV-VENDOR',
        email: 'vendor-org@ats.igsglobal.co',
        contactName: 'Dev Vendor Contact',
        status: 'ACTIVE',
        notes: 'Dev vendor org (portal login: vendor@ats.igsglobal.co).',
    },
];
async function main() {
    console.log('Seeding vendors...');
    for (const v of SAMPLE_VENDORS) {
        const row = await prisma.vendor.upsert({
            where: { code: v.code },
            update: {
                name: v.name,
                email: v.email,
                phone: 'phone' in v ? (v.phone ?? null) : null,
                contactName: v.contactName,
                website: 'website' in v ? v.website ?? null : null,
                status: v.status,
                notes: v.notes ?? null,
            },
            create: {
                name: v.name,
                code: v.code,
                email: v.email,
                phone: 'phone' in v ? (v.phone ?? null) : null,
                contactName: v.contactName,
                website: 'website' in v ? v.website ?? null : null,
                status: v.status,
                notes: v.notes ?? null,
            },
        });
        console.log(`  ✓ ${row.code} — ${row.name}`);
    }
    const liveReqs = await prisma.requirement.findMany({
        where: { status: 'LIVE' },
        take: 3,
        select: { id: true, title: true },
    });
    const apex = await prisma.vendor.findUnique({ where: { code: 'APEX' } });
    const nexus = await prisma.vendor.findUnique({ where: { code: 'NEXUS' } });
    if (apex && liveReqs.length > 0) {
        await prisma.vendorRequirement.createMany({
            data: liveReqs.map((r) => ({ vendorId: apex.id, requirementId: r.id })),
            skipDuplicates: true,
        });
        await prisma.requirement.updateMany({
            where: { id: { in: liveReqs.map((r) => r.id) } },
            data: { visibleToVendors: true },
        });
        console.log(`  Assigned ${liveReqs.length} LIVE job(s) to Apex`);
    }
    if (nexus && liveReqs.length > 1) {
        await prisma.vendorRequirement.createMany({
            data: liveReqs.slice(0, 2).map((r) => ({ vendorId: nexus.id, requirementId: r.id })),
            skipDuplicates: true,
        });
        console.log(`  Assigned jobs to Nexus`);
    }
    const count = await prisma.vendor.count();
    console.log(`Done. ${count} vendor(s) in database.`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
