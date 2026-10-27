import { prisma } from './prisma.js';
const SETTING_KEY = 'report_email_controls';
export const DEFAULT_REPORT_MAIL = {
    openRequisitionSubject: 'IGS | Talent Acquisition | Open Requisition status as on {{asOn}}',
    aging: {
        extraTo: [],
        cc: [],
        bcc: ['karthik.vc@igsglobal.com'],
        subject: '{{headline}}: {{jobTitle}}',
    },
};
function emails(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string' || !item.includes('@'))
            continue;
        const email = item.trim().toLowerCase();
        if (seen.has(email))
            continue;
        seen.add(email);
        out.push(email);
    }
    return out;
}
export async function getReportMailControls() {
    const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!row)
        return structuredClone(DEFAULT_REPORT_MAIL);
    try {
        const stored = JSON.parse(row.value);
        return {
            openRequisitionSubject: typeof stored.openRequisitionSubject === 'string' && stored.openRequisitionSubject.trim()
                ? stored.openRequisitionSubject
                : DEFAULT_REPORT_MAIL.openRequisitionSubject,
            aging: {
                extraTo: emails(stored.aging?.extraTo),
                cc: emails(stored.aging?.cc),
                bcc: stored.aging?.bcc ? emails(stored.aging.bcc) : DEFAULT_REPORT_MAIL.aging.bcc,
                subject: typeof stored.aging?.subject === 'string' && stored.aging.subject.trim()
                    ? stored.aging.subject
                    : DEFAULT_REPORT_MAIL.aging.subject,
            },
        };
    }
    catch {
        return structuredClone(DEFAULT_REPORT_MAIL);
    }
}
export async function saveReportMailControls(input, updatedBy) {
    const next = {
        openRequisitionSubject: input.openRequisitionSubject.trim() || DEFAULT_REPORT_MAIL.openRequisitionSubject,
        aging: {
            extraTo: emails(input.aging.extraTo),
            cc: emails(input.aging.cc),
            bcc: emails(input.aging.bcc),
            subject: input.aging.subject.trim() || DEFAULT_REPORT_MAIL.aging.subject,
        },
    };
    await prisma.appSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: JSON.stringify(next), updatedBy },
        update: { value: JSON.stringify(next), updatedBy },
    });
    return next;
}
export function fillReportSubject(template, values) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? '');
}
