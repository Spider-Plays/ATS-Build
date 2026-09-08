/**
 * Backfill Requirement.quarter, reqMonth, projectName, orgUnit, hireType,
 * and globalJobType for rows missing those fields.
 *
 * Quarter / month derive from targetStartDate (fallback: createdAt).
 * Project name falls back to the job title.
 * Hire type falls back from employmentChannel (External / Internal).
 * Global job type falls back from seniorityLevel.
 *
 * Usage:
 *   npx tsx src/scripts/backfill-requirement-period-fields.ts
 *   npx tsx src/scripts/backfill-requirement-period-fields.ts --dry-run
 */
import { prisma } from '../lib/prisma.js';
const dryRun = process.argv.includes('--dry-run');
const EMPLOYMENT_CHANNEL_LABELS = {
    EXTERNAL: 'External',
    INTERNAL: 'Internal',
};
const SENIORITY_LABELS = {
    ENTRY_LEVEL: 'Entry Level',
    INTERMEDIATE: 'Intermediate',
    SPECIALIST: 'Specialist',
    MANAGER: 'Manager',
    MASTER: 'Master',
};
/** Fiscal quarter label, e.g. `Q1 2024` (Apr–Mar FY). */
function quarterFromDate(date) {
    const month = date.getMonth(); // 0–11
    const calendarYear = date.getFullYear();
    if (month >= 3 && month <= 5)
        return `Q1 ${calendarYear}`;
    if (month >= 6 && month <= 8)
        return `Q2 ${calendarYear}`;
    if (month >= 9 && month <= 11)
        return `Q3 ${calendarYear}`;
    return `Q4 ${calendarYear - 1}`;
}
function monthKeyFromDate(date) {
    return String(date.getMonth() + 1).padStart(2, '0');
}
async function main() {
    const rows = await prisma.requirement.findMany({
        select: {
            id: true,
            title: true,
            projectName: true,
            quarter: true,
            reqMonth: true,
            orgUnit: true,
            department: true,
            hireType: true,
            employmentChannel: true,
            globalJobType: true,
            seniorityLevel: true,
            targetStartDate: true,
            createdAt: true,
        },
    });
    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
        const anchor = row.targetStartDate ?? row.createdAt;
        const next = {};
        if (!row.projectName?.trim()) {
            next.projectName = row.title.trim().slice(0, 200) || 'Untitled project';
        }
        if (!row.quarter?.trim()) {
            next.quarter = quarterFromDate(anchor);
        }
        if (!row.reqMonth?.trim()) {
            next.reqMonth = monthKeyFromDate(anchor);
        }
        if (!row.orgUnit?.trim() && row.department?.trim()) {
            next.orgUnit = row.department.trim().slice(0, 200);
        }
        if (!row.hireType?.trim() && row.employmentChannel?.trim()) {
            next.hireType =
                EMPLOYMENT_CHANNEL_LABELS[row.employmentChannel] ?? row.employmentChannel;
        }
        if (!row.globalJobType?.trim() && row.seniorityLevel?.trim()) {
            next.globalJobType =
                SENIORITY_LABELS[row.seniorityLevel] ?? row.seniorityLevel;
        }
        if (Object.keys(next).length === 0) {
            skipped++;
            continue;
        }
        updated++;
        if (dryRun) {
            console.log(`[dry-run] ${row.id} ${row.title.slice(0, 40)} →`, next);
            continue;
        }
        await prisma.requirement.update({
            where: { id: row.id },
            data: next,
        });
    }
    console.log(dryRun
        ? `Dry run complete: would update ${updated}, already complete ${skipped}, total ${rows.length}`
        : `Backfill complete: updated ${updated}, already complete ${skipped}, total ${rows.length}`);
}
main()
    .catch((err) => {
    console.error(err);
    process.exitCode = 1;
})
    .finally(async () => {
    await prisma.$disconnect();
});
