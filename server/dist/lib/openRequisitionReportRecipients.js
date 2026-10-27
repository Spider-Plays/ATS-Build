import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';
export const OPEN_REQ_REPORT_RECIPIENTS_KEY = 'openRequisitionReportRecipients';
const emailList = z.array(z.string().trim().email()).max(40);
const recipientsSchema = z.object({
    to: emailList,
    cc: emailList.optional().default([]),
    bcc: emailList.optional().default([]),
});
function uniqueEmails(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const email = value.trim().toLowerCase();
        if (!email || seen.has(email))
            continue;
        seen.add(email);
        result.push(email);
    }
    return result;
}
export function normalizeOpenRequisitionReportRecipients(input) {
    const to = uniqueEmails(input.to ?? []);
    const toSet = new Set(to);
    const cc = uniqueEmails(input.cc ?? []).filter((email) => !toSet.has(email));
    const used = new Set([...to, ...cc]);
    const bcc = uniqueEmails(input.bcc ?? []).filter((email) => !used.has(email));
    return { to, cc, bcc };
}
function defaultRecipients() {
    return normalizeOpenRequisitionReportRecipients({ to: env.openRequisitionReportTo });
}
export async function getOpenRequisitionReportRecipients() {
    const row = await prisma.appSetting.findUnique({ where: { key: OPEN_REQ_REPORT_RECIPIENTS_KEY } });
    if (!row?.value)
        return defaultRecipients();
    try {
        const parsed = recipientsSchema.parse(JSON.parse(row.value));
        const normalized = normalizeOpenRequisitionReportRecipients(parsed);
        if (normalized.to.length === 0)
            return defaultRecipients();
        return normalized;
    }
    catch {
        return defaultRecipients();
    }
}
export async function saveOpenRequisitionReportRecipients(input, updatedBy) {
    const parsed = recipientsSchema.parse({
        to: input.to ?? [],
        cc: input.cc ?? [],
        bcc: input.bcc ?? [],
    });
    const recipients = normalizeOpenRequisitionReportRecipients(parsed);
    if (recipients.to.length === 0) {
        throw new Error('Choose at least one To recipient');
    }
    await prisma.appSetting.upsert({
        where: { key: OPEN_REQ_REPORT_RECIPIENTS_KEY },
        create: {
            key: OPEN_REQ_REPORT_RECIPIENTS_KEY,
            value: JSON.stringify(recipients),
            updatedBy,
        },
        update: { value: JSON.stringify(recipients), updatedBy },
    });
    return recipients;
}
