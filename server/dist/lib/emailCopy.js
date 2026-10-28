import { prisma } from './prisma.js';
import { EMAIL_TOGGLE_KEYS, EMAIL_TOGGLE_LABELS } from './emailToggles.js';
export const EMAIL_COPY_PLACEHOLDERS = {
    invite: ['name', 'role', 'setupUrl', 'appName'],
    vendorInvite: ['name', 'setupUrl', 'appName'],
    adminPasswordReset: ['name', 'appName'],
    passwordReset: ['name', 'resetUrl', 'appName'],
    interviewScheduled: ['candidateName', 'type', 'scheduledAt', 'meetingLink', 'location'],
    interviewUpdated: ['candidateName', 'type', 'scheduledAt', 'meetingLink', 'location'],
    interviewCancelled: ['recipientName', 'type', 'scheduledAt', 'candidateName'],
    interviewReminder: ['recipientName', 'type', 'scheduledAt', 'hoursUntil', 'meetingLink', 'location', 'candidateName'],
    interviewerAssigned: ['recipientName', 'candidateName', 'type', 'scheduledAt', 'meetingLink', 'location', 'headline'],
    offerSent: ['candidateName', 'appName', 'portalOfferUrl'],
    offerAccepted: ['recipientName', 'candidateName', 'jobTitle'],
    offerDeclined: ['recipientName', 'candidateName', 'jobTitle'],
    offerPendingHr: ['recipientName', 'subject', 'body'],
    offerPendingExecutive: ['recipientName', 'subject', 'body'],
    offerApprovedStaff: ['recipientName', 'subject', 'body'],
    offerRejectedStaff: ['recipientName', 'subject', 'body'],
    candidateStatus: ['candidateName', 'jobTitle', 'status', 'message', 'portalUrl'],
    candidateStatusStaff: ['recipientName', 'subject', 'body'],
    jobDescription: ['candidateName', 'jobTitle', 'client', 'jobCode', 'jobDescription'],
    referralSubmitted: ['referrerName', 'candidateName', 'jobTitle', 'appName'],
    referralStatus: ['referrerName', 'candidateName', 'jobTitle', 'status'],
    newCandidate: ['recipientName', 'candidateName', 'jobTitle'],
    vendorAssignment: ['recipientName', 'vendorName', 'roles', 'portalUrl'],
    vendorCreationRequest: ['recipientName', 'subject', 'body'],
    vendorCreationApproved: ['recipientName', 'subject', 'body'],
    vendorCreationRejected: ['recipientName', 'subject', 'body'],
    vendorOnboardingSubmitted: ['recipientName', 'subject', 'body'],
    vendorOnboardingHrReview: ['recipientName', 'subject', 'body'],
    vendorOnboardingApproved: ['recipientName', 'subject', 'body'],
    vendorOnboardingRevision: ['recipientName', 'subject', 'body'],
    requirementAfterSow: ['recipientName', 'subject', 'body'],
    businessRequirementStage: ['recipientName', 'subject', 'body'],
    requirementAging: ['recipientName', 'title', 'jobCode', 'daysOpen', 'threshold', 'requirementUrl'],
    openRequisitionReport: ['asOn', 'active'],
    m365Test: ['appName'],
};
export const DEFAULT_EMAIL_COPY = {
    invite: {
        subject: "You're invited to {{appName}}",
        body: 'Hello {{name}},\n\nYou are invited to {{appName}} as {{role}}.\n\nChoose your password (the link works once and expires in 24 hours):\n{{setupUrl}}',
    },
    vendorInvite: {
        subject: 'Welcome to {{appName}} vendor portal — complete your onboarding',
        body: 'Hello {{name}},\n\nYour vendor portal login is ready.\n\nChoose your password (the link works once and expires in 24 hours):\n{{setupUrl}}',
    },
    adminPasswordReset: {
        subject: 'Your {{appName}} password was reset',
        body: 'Hello {{name}},\n\nAn administrator reset your password. They will share the temporary password with you directly.',
    },
    passwordReset: {
        subject: 'Reset your {{appName}} password',
        body: 'Hello {{name}},\n\nUse this link to choose a new password:\n{{resetUrl}}',
    },
    interviewScheduled: {
        subject: 'Interview scheduled — {{type}}',
        body: 'Hello {{candidateName}},\n\nYour {{type}} interview is scheduled for {{scheduledAt}}.\nLocation: {{location}}\nMeeting: {{meetingLink}}',
    },
    interviewUpdated: {
        subject: 'Interview updated — {{type}}',
        body: 'Hello {{candidateName}},\n\nYour {{type}} interview details changed.\nWhen: {{scheduledAt}}\nLocation: {{location}}\nMeeting: {{meetingLink}}',
    },
    interviewCancelled: {
        subject: 'Interview cancelled — {{type}}',
        body: 'Hello {{recipientName}},\n\nThe {{type}} interview for {{candidateName}} on {{scheduledAt}} has been cancelled.',
    },
    interviewReminder: {
        subject: 'Interview reminder — {{type}}',
        body: 'Hello {{recipientName}},\n\nA {{type}} interview for {{candidateName}} starts in about {{hoursUntil}} hour(s), at {{scheduledAt}}.\nLocation: {{location}}\nMeeting: {{meetingLink}}',
    },
    interviewerAssigned: {
        subject: '{{headline}}',
        body: 'Hello {{recipientName}},\n\nYou are assigned to interview {{candidateName}} ({{type}}) at {{scheduledAt}}.\nLocation: {{location}}\nMeeting: {{meetingLink}}',
    },
    offerSent: {
        subject: 'Congratulations — your offer from {{appName}}',
        body: 'Hello {{candidateName}},\n\nYour offer from {{appName}} is ready to review.\n{{portalOfferUrl}}',
    },
    offerAccepted: {
        subject: 'Offer accepted — {{candidateName}}',
        body: 'Hello {{recipientName}},\n\n{{candidateName}} accepted the offer for {{jobTitle}}.',
    },
    offerDeclined: {
        subject: 'Offer declined — {{candidateName}}',
        body: 'Hello {{recipientName}},\n\n{{candidateName}} declined the offer for {{jobTitle}}.',
    },
    offerPendingHr: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    offerPendingExecutive: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    offerApprovedStaff: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    offerRejectedStaff: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    candidateStatus: {
        subject: 'Application update — {{jobTitle}}',
        body: 'Hello {{candidateName}},\n\n{{message}}\n\nRole: {{jobTitle}}\nStatus: {{status}}\n{{portalUrl}}',
    },
    candidateStatusStaff: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    jobDescription: {
        subject: 'Job description — {{jobTitle}}',
        body: 'Hello {{candidateName}},\n\nRole: {{jobTitle}}\nClient: {{client}}\nCode: {{jobCode}}\n\n{{jobDescription}}',
    },
    referralSubmitted: {
        subject: 'Referral submitted — {{candidateName}}',
        body: 'Hello {{referrerName}},\n\nYour referral {{candidateName}} for {{jobTitle}} was submitted.',
    },
    referralStatus: {
        subject: 'Referral update — {{candidateName}}',
        body: 'Hello {{referrerName}},\n\n{{candidateName}} ({{jobTitle}}) is now {{status}}.',
    },
    newCandidate: {
        subject: 'New candidate — {{candidateName}}',
        body: 'Hello {{recipientName}},\n\n{{candidateName}} was added for {{jobTitle}}.',
    },
    vendorAssignment: {
        subject: 'New job assignments — {{vendorName}}',
        body: 'Hello {{recipientName}},\n\n{{vendorName}} has new open roles:\n{{roles}}\n{{portalUrl}}',
    },
    vendorCreationRequest: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    vendorCreationApproved: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    vendorCreationRejected: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    vendorOnboardingSubmitted: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    vendorOnboardingHrReview: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    vendorOnboardingApproved: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    vendorOnboardingRevision: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    requirementAfterSow: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    businessRequirementStage: {
        subject: '{{subject}}',
        body: 'Hello {{recipientName}},\n\n{{body}}',
    },
    requirementAging: {
        subject: 'Requirement aging — {{threshold}} days: {{title}}',
        body: 'Hello {{recipientName}},\n\n{{title}} ({{jobCode}}) has been open {{daysOpen}} days and crossed {{threshold}} days.\n{{requirementUrl}}',
    },
    openRequisitionReport: {
        subject: 'IGS | Talent Acquisition | Open Requisition status as on {{asOn}}',
        body: 'Open requisition status as on {{asOn}}. Active requisitions: {{active}}.\n\nThe report table is attached below this note.',
    },
    m365Test: {
        subject: '{{appName}} — Microsoft 365 test email',
        body: 'This is a test message from {{appName}}. If you received it, Microsoft 365 mail is configured.',
    },
};
const SETTING_KEY = 'email_copy';
function slotList(value) {
    if (!Array.isArray(value))
        return [];
    const allowed = new Set([
        'hr_head',
        'ta_manager',
        'hiring_manager',
        'account_manager',
        'recruiter',
        'ta_operation',
        'candidate',
        'interview_panel',
        'referral_team',
        'referrer',
        'vendor',
    ]);
    return [...new Set(value.map((item) => String(item)).filter((item) => allowed.has(item)))];
}
function addressList(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const out = [];
    for (const item of value) {
        const email = String(item).trim().toLowerCase();
        if (!email || seen.has(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            continue;
        seen.add(email);
        out.push(email);
    }
    return out;
}
function fill(template, vars) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => vars[key] ?? '');
}
export function fillEmailCopy(copy, vars) {
    return { ...copy, subject: fill(copy.subject, vars), body: fill(copy.body, vars) };
}
export async function getEmailCopies() {
    const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    const stored = (() => {
        if (!setting)
            return {};
        try {
            return JSON.parse(setting.value);
        }
        catch {
            return {};
        }
    })();
    return Object.fromEntries(EMAIL_TOGGLE_KEYS.map((key) => {
        const row = stored[key];
        const storedRow = row && typeof row === 'object' ? row : {};
        const subject = typeof storedRow.subject === 'string' ? storedRow.subject : DEFAULT_EMAIL_COPY[key].subject;
        const body = typeof storedRow.body === 'string' ? storedRow.body : DEFAULT_EMAIL_COPY[key].body;
        return [
            key,
            {
                subject,
                body,
                to: slotList(storedRow.to),
                cc: slotList(storedRow.cc),
                bcc: slotList(storedRow.bcc),
                extraTo: addressList(storedRow.extraTo),
                extraCc: addressList(storedRow.extraCc),
                extraBcc: addressList(storedRow.extraBcc),
            },
        ];
    }));
}
export async function saveEmailCopies(input, updatedBy) {
    const current = await getEmailCopies();
    const next = { ...current };
    for (const key of EMAIL_TOGGLE_KEYS) {
        const row = input[key];
        if (!row)
            continue;
        next[key] = {
            subject: String(row.subject ?? current[key].subject),
            body: String(row.body ?? current[key].body),
            to: slotList(row.to ?? current[key].to),
            cc: slotList(row.cc ?? current[key].cc),
            bcc: slotList(row.bcc ?? current[key].bcc),
            extraTo: addressList(row.extraTo ?? current[key].extraTo),
            extraCc: addressList(row.extraCc ?? current[key].extraCc),
            extraBcc: addressList(row.extraBcc ?? current[key].extraBcc),
        };
    }
    await prisma.appSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: JSON.stringify(next), updatedBy },
        update: { value: JSON.stringify(next), updatedBy },
    });
    return next;
}
export async function resolveEmailWording(kind, fallback, vars) {
    const copies = await getEmailCopies();
    const copy = copies[kind];
    const defaults = DEFAULT_EMAIL_COPY[kind];
    const subjectChanged = copy.subject !== defaults.subject;
    const bodyChanged = copy.body !== defaults.body;
    if (!subjectChanged && !bodyChanged) {
        return { subject: fallback.subject, html: fallback.html, bodyChanged: false };
    }
    const filled = fillEmailCopy(copy, vars ?? {});
    return {
        subject: subjectChanged ? filled.subject : fallback.subject,
        html: fallback.html,
        bodyChanged,
    };
}
export function emailCopyLabel(kind) {
    return EMAIL_TOGGLE_LABELS[kind];
}
