import { prisma } from './prisma.js';
/** Requisition ID: REQ + DD + MM + YYYY + ### (e.g. REQ28062026001). */
export function buildJobCodePrefix(date = new Date()) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `REQ${dd}${mm}${yyyy}`;
}
export function formatJobCode(date, sequence) {
    return `${buildJobCodePrefix(date)}${String(sequence).padStart(3, '0')}`;
}
/** REQ + 11 digits (DDMMYYYY + ###). */
export function isStandardJobCode(code) {
    return typeof code === 'string' && /^REQ\d{11}$/.test(code);
}
function nextSequenceFromCodes(prefix, codes) {
    let max = 0;
    for (const code of codes) {
        if (!code?.startsWith(prefix))
            continue;
        const seq = Number.parseInt(code.slice(prefix.length), 10);
        if (!Number.isNaN(seq))
            max = Math.max(max, seq);
    }
    return max + 1;
}
/** Next human-readable requisition code for the given calendar day. */
export async function generateJobCode(date = new Date()) {
    const prefix = buildJobCodePrefix(date);
    const rows = await prisma.requirement.findMany({
        where: { jobCode: { startsWith: prefix } },
        select: { jobCode: true },
    });
    const seq = nextSequenceFromCodes(prefix, rows.map((r) => r.jobCode ?? ''));
    return formatJobCode(date, seq);
}
/**
 * Reassign job codes for all requirements using each row's createdAt date.
 * Keeps valid unique codes; remaps legacy values (DEMO-*, REQ-*, etc.).
 */
export async function migrateRequirementJobCodes() {
    const rows = await prisma.requirement.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, jobCode: true, createdAt: true },
    });
    const assigned = new Map();
    const usedCodes = new Set();
    const seqByPrefix = new Map();
    for (const row of rows) {
        const code = row.jobCode;
        if (!isStandardJobCode(code) || usedCodes.has(code))
            continue;
        const prefix = code.slice(0, 11);
        const seq = Number.parseInt(code.slice(11), 10);
        if (Number.isNaN(seq))
            continue;
        usedCodes.add(code);
        assigned.set(row.id, code);
        seqByPrefix.set(prefix, Math.max(seqByPrefix.get(prefix) ?? 0, seq));
    }
    for (const row of rows) {
        if (assigned.has(row.id))
            continue;
        const prefix = buildJobCodePrefix(row.createdAt);
        let next = (seqByPrefix.get(prefix) ?? 0) + 1;
        let code = formatJobCode(row.createdAt, next);
        while (usedCodes.has(code)) {
            next++;
            code = formatJobCode(row.createdAt, next);
        }
        seqByPrefix.set(prefix, next);
        usedCodes.add(code);
        assigned.set(row.id, code);
    }
    let updated = 0;
    let unchanged = 0;
    for (const row of rows) {
        const code = assigned.get(row.id);
        if (row.jobCode === code) {
            unchanged++;
            continue;
        }
        await prisma.requirement.update({
            where: { id: row.id },
            data: { jobCode: code },
        });
        updated++;
    }
    return { updated, unchanged, total: rows.length };
}
