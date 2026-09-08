import { prisma } from './prisma.js';
/** First 3 letters of the vendor name (A–Z only). Pads with X if shorter; fallback VND. */
export function vendorCodePrefixFromName(name) {
    const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (letters.length >= 3)
        return letters.slice(0, 3);
    if (letters.length > 0)
        return letters.padEnd(3, 'X');
    return 'VND';
}
/**
 * Vendor code = first 3 letters + sequential ###.
 * e.g. "Apex Staffing" → APE001, then APE002, …
 */
export async function generateVendorCode(name) {
    const prefix = vendorCodePrefixFromName(name);
    const rows = await prisma.vendor.findMany({
        where: { code: { startsWith: prefix } },
        select: { code: true },
    });
    let max = 0;
    const re = new RegExp(`^${prefix}(\\d{3})$`);
    for (const row of rows) {
        const match = row.code?.match(re);
        if (!match)
            continue;
        const seq = Number.parseInt(match[1], 10);
        if (!Number.isNaN(seq))
            max = Math.max(max, seq);
    }
    const next = max + 1;
    if (next > 999) {
        return `${prefix}${Date.now().toString(36).toUpperCase()}`.slice(0, 32);
    }
    return `${prefix}${String(next).padStart(3, '0')}`;
}
