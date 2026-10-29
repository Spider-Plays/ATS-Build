import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { sendHtmlEmail } from '../services/email.js';
import { emailShell } from '../services/email.js';
import { emailsForRoleSlots, getUserEmailsByIds, getUserEmailsByRoles } from './emailRecipients.js';
export const WORKFLOW_MAIL_KEYS = [
    'requirementRaised',
    'requirementApproved',
    'recruiterAssigned',
    'recruiterAccepted',
    'requirementUpdated',
    'candidateCreated',
    'interviewScheduledCandidate',
    'interviewScheduledPanel',
    'interviewRsvpAccepted',
    'interviewRsvpDeclined',
    'interviewFeedback',
    'requirementStageChanged',
    'referralSubmitted',
    'referralRejected',
    'referralAssigned',
    'referralRecruiterRejected',
    'referralJoined',
];
export const WORKFLOW_SLOTS = [
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
];
export const WORKFLOW_SLOT_LABELS = {
    hr_head: 'HR Head',
    ta_manager: 'TA Manager',
    hiring_manager: 'Hiring manager of the requirement',
    account_manager: 'Account manager of the requirement',
    recruiter: 'Assigned recruiter',
    ta_operation: 'Users with TA Operation tag',
    candidate: 'Candidate',
    interview_panel: 'Interview panel',
    referral_team: 'Users with Employee referral tag',
    referrer: 'Referring employee',
    vendor: 'Vendor portal user',
};
export const WORKFLOW_MAIL_LABELS = {
    requirementRaised: 'Requirement raised',
    requirementApproved: 'Requirement approved',
    recruiterAssigned: 'Recruiter assigned',
    recruiterAccepted: 'Recruiter accepted',
    requirementUpdated: 'Requirement updated',
    candidateCreated: 'Candidate profile created',
    interviewScheduledCandidate: 'Interview scheduled — candidate',
    interviewScheduledPanel: 'Interview scheduled',
    interviewRsvpAccepted: 'Interview invite accepted',
    interviewRsvpDeclined: 'Interview invite declined',
    interviewFeedback: 'Interview feedback submitted',
    requirementStageChanged: 'Requirement stage changed',
    referralSubmitted: 'Employee referral submitted',
    referralRejected: 'Employee referral rejected',
    referralAssigned: 'Employee referral assigned to recruiter',
    referralRecruiterRejected: 'Employee referral rejected by recruiter',
    referralJoined: 'Employee referral joined',
};
const KARTHIK = 'karthik.vc@igsglobal.com';
const RAISED_BODY = `A new requirement has been raised for {{jobTitle}} — {{client}}.

- Req ID : {{reqId}}
- Client : {{client}}
- Business Type : {{businessType}}
- Org Unit : {{orgUnit}}
- Domain : {{domain}}
- Project : {{project}}
- Target Start Date : {{targetStartDate}}
- Location : {{location}}
- Type of employment : {{employmentType}}
- Designation : {{designation}}
- Experience : {{experience}}
- Qualification : {{qualification}}
- Primary Skill set : {{primarySkills}}
- Secondary Skill set : {{secondarySkills}}
- Sal Budget : {{salaryBudget}}
- Hire Category : {{hireCategory}}
- Hire Type : {{hireType}}

Job description
{{jobDescription}}`;
const REFERRAL_DETAILS = `- Candidate : {{candidateName}}
- Email : {{candidateEmail}}
- Phone : {{candidatePhone}}
- Total experience : {{totalExperience}}
- Current company : {{currentCompany}}
- Role : {{jobTitle}}
- Req ID : {{reqId}}
- Referred by : {{referrerName}}
- Relationship : {{referralRelationship}}`;
function template(partial) {
    return {
        enabled: true,
        bcc: [],
        extraTo: [],
        extraCc: [],
        extraBcc: [KARTHIK],
        ...partial,
    };
}
export const DEFAULT_WORKFLOW_TEMPLATES = {
    requirementRaised: template({
        to: ['hr_head'],
        cc: ['ta_manager', 'hiring_manager', 'account_manager', 'recruiter', 'ta_operation'],
        subject: 'Requirement raised — {{jobTitle}} — {{client}}',
        body: RAISED_BODY,
    }),
    requirementApproved: template({
        to: ['hiring_manager'],
        cc: ['ta_manager', 'hr_head', 'account_manager', 'recruiter', 'ta_operation'],
        subject: 'Requirement approved — {{jobTitle}} — {{client}}',
        body: `The requirement {{jobTitle}} — {{client}} ({{reqId}}) has been approved and is live.\n\n${RAISED_BODY}`,
    }),
    recruiterAssigned: template({
        to: ['recruiter'],
        cc: ['ta_manager', 'ta_operation'],
        subject: 'Requirement assigned to you — {{jobTitle}}',
        body: `This requirement is assigned to you. Go to ATS, accept it, and start working on it.\n\n{{portalButton}}\n\n${RAISED_BODY}`,
    }),
    recruiterAccepted: template({
        to: ['ta_operation'],
        cc: ['ta_manager', 'recruiter'],
        subject: 'Recruiter accepted — {{jobTitle}} — {{client}}',
        body: `{{recruiterName}} has accepted the requirement {{jobTitle}} — {{client}} ({{reqId}}).`,
    }),
    requirementUpdated: template({
        to: ['recruiter', 'ta_manager', 'ta_operation'],
        cc: ['hiring_manager', 'account_manager'],
        subject: 'Requirement updated — {{jobTitle}} — {{client}}',
        body: `The requirement {{jobTitle}} — {{client}} ({{reqId}}) was updated. Only the fields below changed. Everything else is the same.\n\n{{updatedDetails}}`,
    }),
    candidateCreated: template({
        to: ['recruiter'],
        cc: ['ta_operation'],
        subject: 'Candidate profile created — {{candidateName}}',
        body: `A candidate profile has been created.\n\n- Name : {{candidateName}}\n- Email : {{candidateEmail}}\n- Role : {{jobTitle}}\n- Req ID : {{reqId}}`,
    }),
    interviewScheduledCandidate: template({
        to: ['candidate'],
        cc: [],
        subject: 'Interview: {{candidateName}} - {{jobTitle}} - {{interviewRound}}',
        body: `Hello {{candidateName}},

Greetings from IGS! In continuation to your discussion with us regarding the job opportunity, we are keen to invite you to a {{interviewRound}}.

- Position : {{jobTitle}}
- Date : {{interviewDate}}
- Time : {{interviewTime}} IST
- Mode : MS Teams (Video Conferencing)

Please accept the meeting invite to confirm your availability.

{{joinMeetingButton}}

Regards,
Talent Acquisition, IGS Global
For any changes, please reach out to {{recruiterName}}.`,
    }),
    interviewScheduledPanel: template({
        to: ['interview_panel'],
        cc: ['recruiter', 'ta_operation'],
        subject: 'Interview: {{candidateName}} - {{jobTitle}} - {{interviewRound}}',
        body: `Hello {{panelName}}

An Interview has been scheduled with you at {{interviewTime}} on {{interviewDate}} and the details are as follows,

- Project : {{project}}
- Candidate : {{candidateName}}
- Position : {{jobTitle}}
- Interview type : {{interviewRound}}
- Date & time : {{interviewDate}}, {{interviewTime}} IST
- Mode : MS Teams (Video Conferencing)

Login to Stitch ATS to access Resume and Job Description and to submit the Feedback

{{joinMeetingButton}} {{portalButton}}

Please note : For {{interviewRound}} - Assessment comment must include detailed feedback based on the JD content (Skills, domain, tools etc), hence, Please refer JD while conducting the interview to ensure all the areas are covered.

Note :
1) You need to login to Stitch ATS using your IGS account by Clicking on continue with Microsoft
2) in case of any errors or not able to login please reachout to Stitch ATS Admin`,
    }),
    interviewRsvpAccepted: template({
        to: ['recruiter'],
        cc: ['ta_operation'],
        subject: 'Interview accepted — {{respondentName}} — {{jobTitle}}',
        body: `{{respondentName}} ({{respondentRole}}) accepted the interview invite for {{candidateName}} — {{jobTitle}} ({{client}}).\n\n- When : {{scheduledAt}}\n- Round : {{interviewRound}}`,
    }),
    interviewRsvpDeclined: template({
        to: ['recruiter'],
        cc: ['ta_operation'],
        subject: 'Interview declined — {{respondentName}} — {{jobTitle}}',
        body: `{{respondentName}} ({{respondentRole}}) declined the interview invite for {{candidateName}} — {{jobTitle}} ({{client}}).\n\n- When : {{scheduledAt}}\n- Round : {{interviewRound}}`,
    }),
    interviewFeedback: template({
        to: ['recruiter'],
        cc: ['ta_manager', 'ta_operation'],
        subject: 'Interview feedback — {{candidateName}} — {{interviewRound}}',
        body: `Feedback was submitted for {{candidateName}} on {{jobTitle}} ({{reqId}}).\n\n- Round : {{interviewRound}}\n- Recommendation : {{recommendation}}\n- Rating : {{rating}}\n\n{{feedbackBody}}`,
    }),
    requirementStageChanged: template({
        to: ['hiring_manager', 'recruiter'],
        cc: ['ta_manager', 'ta_operation'],
        subject: 'Requirement stage changed — {{jobTitle}}',
        body: `{{jobTitle}} — {{client}} ({{reqId}}) moved from {{previousStage}} to {{hiringStage}}.`,
    }),
    referralSubmitted: template({
        to: ['referral_team'],
        cc: ['ta_operation', 'ta_manager'],
        subject: 'Employee referral — {{candidateName}} — {{jobTitle}}',
        body: `{{referrerName}} referred {{candidateName}}. Review the profile and assign it to a recruiter or reject it.

${REFERRAL_DETAILS}

{{portalButton}}`,
    }),
    referralRejected: template({
        to: ['referrer'],
        cc: ['referral_team', 'ta_operation', 'ta_manager'],
        subject: 'Employee referral not taken forward — {{candidateName}}',
        body: `The referral of {{candidateName}} by {{referrerName}} was reviewed and will not be taken forward.

- Reason : {{rejectionReason}}
- Reviewed by : {{actorName}}

${REFERRAL_DETAILS}`,
    }),
    referralAssigned: template({
        to: ['recruiter'],
        cc: ['referral_team', 'ta_operation', 'ta_manager'],
        subject: 'Employee referral assigned to you — {{candidateName}}',
        body: `{{actorName}} assigned the referral of {{candidateName}} to {{recruiterName}}. Open Approvals in Stitch ATS to accept or reject the profile.

${REFERRAL_DETAILS}

{{portalButton}}`,
    }),
    referralRecruiterRejected: template({
        to: ['referral_team'],
        cc: ['ta_operation', 'ta_manager'],
        subject: 'Employee referral rejected by recruiter — {{candidateName}}',
        body: `{{recruiterName}} rejected the referral of {{candidateName}}. The profile is moved to Bank and stays on the Employee Referral page, where it can be assigned to another recruiter.

- Reason : {{rejectionReason}}

${REFERRAL_DETAILS}

{{portalButton}}`,
    }),
    referralJoined: template({
        to: ['referrer'],
        cc: ['referral_team', 'ta_operation', 'ta_manager'],
        subject: 'Employee referral joined — {{candidateName}}',
        body: `{{candidateName}}, referred by {{referrerName}}, has joined IGS.

- Candidate : {{candidateName}}
- Email : {{candidateEmail}}
- Role : {{jobTitle}}
- Req ID : {{reqId}}
- Date of joining : {{joiningDate}}
- Recruiter : {{recruiterName}}
- Total experience : {{totalExperience}}

The referral bonus is processed after the candidate completes 6 months.`,
    }),
};
const SETTING_KEY = 'workflow_email_templates';
function interviewBody(stored, fallback) {
    if (typeof stored !== 'string' || !stored.trim())
        return fallback;
    if (fallback.startsWith('Hello {{candidateName}}') && !stored.startsWith('Hello {{candidateName}}'))
        return fallback;
    if (fallback.includes('{{joinMeetingButton}} {{portalButton}}') && !stored.includes('{{joinMeetingButton}} {{portalButton}}'))
        return fallback;
    if (fallback.includes('joinMeetingButton') && !stored.includes('joinMeetingButton'))
        return fallback;
    if (fallback.includes('acceptInviteButton') && !stored.includes('acceptInviteButton'))
        return fallback;
    if (stored.includes('{{updatedDetails}}') && !stored.includes('Only the fields below changed'))
        return fallback;
    return stored;
}
function mergeTemplate(stored, fallback) {
    const slots = (value, fallbackSlots) => Array.isArray(value) ? value.filter((s) => WORKFLOW_SLOTS.includes(s)) : fallbackSlots;
    const body = interviewBody(stored?.body, fallback.body);
    const replacedBody = body === fallback.body && stored?.body !== body;
    const storedSubject = typeof stored?.subject === 'string' ? stored.subject.trim() : '';
    const wantsNamedSubject = fallback.subject.includes('{{candidateName}} - {{jobTitle}} - {{interviewRound}}');
    const subject = replacedBody || (wantsNamedSubject && !storedSubject.includes('{{candidateName}} - {{jobTitle}} - {{interviewRound}}'))
        ? fallback.subject
        : storedSubject || fallback.subject;
    return {
        enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : fallback.enabled,
        to: slots(stored?.to, fallback.to),
        cc: replacedBody ? fallback.cc : slots(stored?.cc, fallback.cc),
        bcc: slots(stored?.bcc, fallback.bcc),
        extraTo: Array.isArray(stored?.extraTo)
            ? stored.extraTo.filter((e) => typeof e === 'string' && e.includes('@'))
            : fallback.extraTo,
        extraCc: Array.isArray(stored?.extraCc)
            ? stored.extraCc.filter((e) => typeof e === 'string' && e.includes('@'))
            : fallback.extraCc,
        extraBcc: Array.isArray(stored?.extraBcc)
            ? stored.extraBcc.filter((e) => typeof e === 'string' && e.includes('@'))
            : fallback.extraBcc,
        subject,
        body,
    };
}
export async function getWorkflowTemplates() {
    const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!setting)
        return structuredClone(DEFAULT_WORKFLOW_TEMPLATES);
    try {
        const stored = JSON.parse(setting.value);
        const next = {};
        for (const key of WORKFLOW_MAIL_KEYS) {
            next[key] = mergeTemplate(stored[key], DEFAULT_WORKFLOW_TEMPLATES[key]);
        }
        return next;
    }
    catch {
        return structuredClone(DEFAULT_WORKFLOW_TEMPLATES);
    }
}
export async function saveWorkflowTemplates(incoming, updatedBy) {
    const current = await getWorkflowTemplates();
    const next = { ...current };
    for (const key of WORKFLOW_MAIL_KEYS) {
        if (incoming[key])
            next[key] = mergeTemplate({ ...current[key], ...incoming[key] }, DEFAULT_WORKFLOW_TEMPLATES[key]);
    }
    await prisma.appSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: JSON.stringify(next), updatedBy },
        update: { value: JSON.stringify(next), updatedBy },
    });
    return next;
}
function fill(template, values) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? '');
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** Button links must be absolute http(s) URLs; anything else is dropped rather than rendered. */
function safeButtonHref(raw) {
    const value = raw.trim();
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
    }
    catch {
        return '';
    }
}
/** Stands in for a button row until the surrounding text has been escaped. */
const BUTTON_SLOT = (index) => `\u0000button${index}\u0000`;
const WORKFLOW_BUTTONS = {
    joinMeetingButton: { valueKey: 'meetingLink', label: 'Join meeting' },
    portalButton: { valueKey: 'portalUrl', label: 'Go to portal', outline: true },
    acceptInviteButton: { valueKey: 'acceptInviteUrl', label: 'Accept invite' },
    declineInviteButton: { valueKey: 'declineInviteUrl', label: 'Decline', outline: true },
};
function workflowButtonRow(actions) {
    const cells = actions
        .map((action) => ({ ...action, href: safeButtonHref(action.href) }))
        .filter((action) => action.href)
        .map((action, index) => {
        const gap = index > 0 ? '<td width="10" style="width:10px;font-size:0;line-height:0;">&nbsp;</td>' : '';
        return `${gap}<td align="center" bgcolor="#1266c4" style="background-color:#1266c4;border-radius:6px;">
<a href="${escapeHtml(action.href)}" target="_blank" style="display:inline-block;padding:6px 10px;border-radius:6px;background-color:#1266c4;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;line-height:16px;color:#ffffff;text-decoration:none;white-space:nowrap;">${escapeHtml(action.label)}</a>
</td>`;
    })
        .join('');
    if (!cells)
        return '';
    return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:12px 0 20px;"><tr>${cells}</tr></table>`;
}
function bodyToHtml(template, values) {
    const token = '\\{\\{\\s*(?:joinMeetingButton|portalButton|acceptInviteButton|declineInviteButton)\\s*\\}\\}';
    // Buttons become placeholders on their own paragraph; their markup is swapped in only after
    // every value has been filled and escaped, so no value is ever emitted as raw HTML.
    const buttonRows = [];
    const withButtons = template.replace(new RegExp(`${token}(?:\\s+${token})*`, 'g'), (match) => {
        const actions = [...match.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((found) => {
            const spec = WORKFLOW_BUTTONS[found[1]];
            return { href: values[spec.valueKey] ?? '', label: spec.label, outline: spec.outline };
        });
        buttonRows.push(workflowButtonRow(actions));
        return `\n\n${BUTTON_SLOT(buttonRows.length - 1)}\n\n`;
    });
    // Values cannot smuggle in a placeholder of their own.
    const safeValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value ?? '').replace(/\u0000/g, '')]));
    const text = fill(withButtons, safeValues);
    return text
        .split(/\n{2,}/)
        .map((block) => {
        const trimmed = block.trim();
        if (!trimmed)
            return '';
        const slot = /^\u0000button(\d+)\u0000$/.exec(trimmed);
        if (slot)
            return buttonRows[Number(slot[1])] ?? '';
        const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
        const detailLines = [];
        const rest = [];
        for (const line of lines) {
            if (rest.length === 0 && line.startsWith('- '))
                detailLines.push(line);
            else
                rest.push(line);
        }
        if (detailLines.length > 0) {
            const rows = detailLines
                .map((line) => {
                const raw = line.replace(/^-\s+/, '');
                const splitAt = raw.indexOf(' : ');
                const label = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
                const value = splitAt >= 0 ? raw.slice(splitAt + 3) : '';
                return `<p style="margin:12px 0 4px;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(label)}</p><p style="margin:0;font-size:15px;font-weight:600;color:#1a2b3c;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(value) || '—'}</p>`;
            })
                .join('');
            const box = `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#f0f5fa" style="background-color:#f0f5fa;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 16px;"><tr><td style="padding:8px 20px 16px;">${rows}</td></tr></table>`;
            if (!rest.length)
                return box;
            return `${box}<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1a2b3c;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(rest.join('\n')).replace(/\n/g, '<br/>')}</p>`;
        }
        return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1a2b3c;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(trimmed).replace(/\n/g, '<br/>')}</p>`;
    })
        .join('');
}
function workflowHtml(title, body, values) {
    return emailShell({ headerTitle: title, content: bodyToHtml(body, values) });
}
/** Body-only HTML for Outlook calendar invites. */
export function renderWorkflowContent(body, values) {
    return bodyToHtml(body, values);
}
export function fillWorkflowText(template, values) {
    return fill(template, values);
}
export function renderWorkflowPreview(key, tpl) {
    const sample = {
        jobTitle: 'Senior Java Developer',
        client: 'Acme Corp',
        reqId: 'REQ-1042',
        businessType: 'Staffing',
        orgUnit: 'Engineering',
        domain: 'Banking',
        project: 'Core payments',
        targetStartDate: '1 Nov 2026',
        location: 'Bengaluru',
        employmentType: 'Permanent',
        designation: 'Senior Java Developer',
        experience: '5–8 years',
        qualification: 'B.E. / B.Tech',
        primarySkills: 'Java, Spring Boot',
        secondarySkills: 'Kafka, AWS',
        salaryBudget: '24,00,000',
        hireCategory: 'Lateral',
        hireType: 'New',
        jobDescription: 'Build and own payment services.',
        recruiterName: 'Recruiter',
        candidateName: 'Asha Rao',
        candidateEmail: 'asha@example.com',
        scheduledAt: 'Tue, 6 Oct 2026, 11:00 AM',
        interviewDate: '6 October 2026',
        interviewTime: '11:00 AM',
        panelName: 'Karthik V C',
        interviewRound: 'L1',
        notice: 'You are assigned to this interview.',
        meetingLink: 'https://teams.microsoft.com/l/meetup-join/example',
        portalUrl: `${env.clientOrigin.replace(/\/$/, '')}/interviews/example`,
        acceptInviteUrl: `${env.clientOrigin.replace(/\/$/, '')}/api/interview-rsvp/example?response=accept`,
        declineInviteUrl: `${env.clientOrigin.replace(/\/$/, '')}/api/interview-rsvp/example?response=decline`,
        respondentName: 'Asha Rao',
        respondentRole: 'Candidate',
        recommendation: 'HIRE',
        rating: '4',
        feedbackBody: 'Strong in Java and system design. Recommend moving to the next round.',
        previousStage: 'SOURCING',
        hiringStage: 'INTERVIEW',
        candidatePhone: '+91 98450 12345',
        totalExperience: '6 years',
        currentCompany: 'Infosys',
        referrerName: 'Sneha Iyer',
        referralRelationship: 'Former colleague',
        rejectionReason: 'Skills do not match current openings.',
        actorName: 'Priya (Employee referral team)',
        joiningDate: '2 Nov 2026',
        updatedDetails: '- Location : Hyderabad → Bengaluru\n- Salary budget : 18,00,000 → 24,00,000',
    };
    const subject = fill(tpl.subject, sample);
    const html = workflowHtml(WORKFLOW_MAIL_LABELS[key], tpl.body, sample);
    return { subject, html };
}
async function emailsForSlot(slot, ctx) {
    if (slot === 'vendor')
        return emailsForRoleSlots(['vendor'], ctx.vendorId);
    if (slot === 'hr_head')
        return (await getUserEmailsByRoles(['HR_HEAD'])).map((u) => u.email);
    if (slot === 'ta_manager')
        return (await getUserEmailsByRoles(['TA_MANAGER'])).map((u) => u.email);
    if (slot === 'ta_operation' || slot === 'referral_team') {
        const tag = slot === 'ta_operation' ? 'ta_operation' : 'employee_referral';
        const users = await prisma.user.findMany({
            where: { status: 'ACTIVE' },
            select: { email: true, permissions: true },
        });
        return users
            .filter((u) => {
            try {
                const tags = JSON.parse(u.permissions || '[]');
                return Array.isArray(tags) && tags.includes(tag);
            }
            catch {
                return false;
            }
        })
            .map((u) => u.email);
    }
    if (slot === 'referrer') {
        return ctx.referrerId ? (await getUserEmailsByIds([ctx.referrerId])).map((u) => u.email) : [];
    }
    if (slot === 'candidate')
        return ctx.candidate?.email ? [ctx.candidate.email] : [];
    if (slot === 'interview_panel')
        return (ctx.panelEmails ?? []).map((p) => p.email);
    if (slot === 'recruiter') {
        const ids = ctx.recruiterIds ?? [];
        return (await getUserEmailsByIds(ids)).map((u) => u.email);
    }
    if (!ctx.requirementId)
        return [];
    const requirement = await prisma.requirement.findUnique({
        where: { id: ctx.requirementId },
        select: { hiringManager: true, accountManager: true },
    });
    if (!requirement)
        return [];
    const id = slot === 'hiring_manager' ? requirement.hiringManager : requirement.accountManager;
    if (!id)
        return [];
    const byId = await getUserEmailsByIds([id]);
    if (byId.length)
        return byId.map((u) => u.email);
    const byName = await prisma.user.findMany({
        where: { status: 'ACTIVE', name: { equals: id, mode: 'insensitive' } },
        select: { email: true },
    });
    return byName.map((u) => u.email);
}
function uniqueEmails(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const email = raw.trim();
        const key = email.toLowerCase();
        if (!email.includes('@') || seen.has(key))
            continue;
        seen.add(key);
        out.push(email);
    }
    return out;
}
export async function sendWorkflowMail(input) {
    const templates = await getWorkflowTemplates();
    const tpl = templates[input.key];
    if (!tpl.enabled)
        return { sent: false, reason: 'disabled' };
    const values = input.context.values;
    const [to, cc, bccSlots] = await Promise.all([
        Promise.all(tpl.to.map((slot) => emailsForSlot(slot, input.context))).then((g) => uniqueEmails(g.flat())),
        Promise.all(tpl.cc.map((slot) => emailsForSlot(slot, input.context))).then((g) => uniqueEmails(g.flat())),
        Promise.all(tpl.bcc.map((slot) => emailsForSlot(slot, input.context))).then((g) => uniqueEmails(g.flat())),
    ]);
    const toSet = new Set(to.map((e) => e.toLowerCase()));
    const toAll = uniqueEmails([...to, ...(tpl.extraTo ?? [])]);
    const ccClean = uniqueEmails([...cc, ...(tpl.extraCc ?? [])]).filter((e) => !toSet.has(e.toLowerCase()) && !toAll.some((t) => t.toLowerCase() === e.toLowerCase()));
    const bcc = uniqueEmails([...bccSlots, ...tpl.extraBcc]).filter((e) => !toSet.has(e.toLowerCase()) && !ccClean.some((c) => c.toLowerCase() === e.toLowerCase()));
    if (toAll.length === 0)
        return { sent: false, reason: 'no_recipients' };
    const subject = fill(tpl.subject, values);
    const html = workflowHtml(WORKFLOW_MAIL_LABELS[input.key], tpl.body, values);
    return sendHtmlEmail({
        force: true,
        to: toAll,
        cc: ccClean,
        bcc,
        subject,
        html,
        attachments: input.attachments,
    });
}
const UPDATED_FIELD_LABELS = {
    title: 'Title',
    client: 'Client',
    department: 'Department',
    hiringManager: 'Hiring manager',
    accountManager: 'Account manager',
    location: 'Location',
    locationCity: 'City',
    workMode: 'Work mode',
    isRemote: 'Remote',
    openings: 'Openings',
    priority: 'Priority',
    seniorityLevel: 'Seniority',
    employmentType: 'Employment type',
    businessType: 'Business type',
    domain: 'Domain',
    jobType: 'Job type',
    employmentChannel: 'Employment channel',
    requirementFor: 'Requirement for',
    replacementEmployeeName: 'Replacement for',
    hireCategory: 'Hire category',
    hireType: 'Hire type',
    education: 'Qualification',
    experienceLabel: 'Experience',
    experienceMinYears: 'Minimum experience',
    experienceMaxYears: 'Maximum experience',
    primarySkills: 'Primary skills',
    secondarySkills: 'Secondary skills',
    salaryBand: 'Salary budget',
    projectName: 'Project',
    orgUnit: 'Org unit',
    targetStartDate: 'Target start date',
    jobDescription: 'Job description',
    description: 'Description',
};
function formatFieldValue(value) {
    if (value == null || value === '')
        return '';
    if (typeof value === 'boolean')
        return value ? 'Yes' : 'No';
    if (value instanceof Date)
        return value.toLocaleDateString('en-IN');
    if (Array.isArray(value))
        return value.map((item) => String(item)).filter(Boolean).join(', ');
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed))
                    return parsed.map((item) => String(item)).filter(Boolean).join(', ');
            }
            catch {
                /* keep the string */
            }
        }
        return trimmed.replace(/\s+/g, ' ');
    }
    if (typeof value === 'number')
        return String(value);
    return '';
}
/** Dash lines for fields whose value actually changed: previous → new. */
export function formatUpdatedDetails(data, previous) {
    const lines = Object.entries(UPDATED_FIELD_LABELS)
        .filter(([key]) => Object.prototype.hasOwnProperty.call(data, key))
        .map(([key, label]) => {
        const next = formatFieldValue(data[key]);
        const prior = previous ? formatFieldValue(previous[key]) : '';
        if (previous && next === prior)
            return '';
        if (!next && !prior)
            return '';
        const value = previous ? `${prior || '—'} → ${next || '—'}` : next;
        return `- ${label} : ${value}`;
    })
        .filter(Boolean);
    return lines.length ? lines.join('\n') : '- Updated : No field values changed';
}
function skillList(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string').join(', ') : '';
    }
    catch {
        return '';
    }
}
export async function requirementMailValues(requirementId, extra = {}) {
    const row = await prisma.requirement.findUnique({ where: { id: requirementId } });
    if (!row)
        return null;
    const experience = row.experienceLabel ||
        [row.experienceMinYears, row.experienceMaxYears].filter((n) => n != null).join('–') +
            (row.experienceMinYears != null || row.experienceMaxYears != null ? ' years' : '');
    let qualification = '';
    try {
        const edu = JSON.parse(row.education || '[]');
        qualification = Array.isArray(edu) ? edu.join(', ') : String(row.education || '');
    }
    catch {
        qualification = row.education || '';
    }
    const values = {
        jobTitle: row.title,
        client: row.client ?? '',
        reqId: row.jobCode ?? row.id,
        businessType: row.businessType ?? '',
        orgUnit: row.orgUnit || row.department || '',
        domain: row.domain ?? '',
        project: row.projectName ?? '',
        targetStartDate: row.targetStartDate ? row.targetStartDate.toLocaleDateString('en-IN') : '',
        location: row.location || row.locationCity || '',
        employmentType: row.employmentType ?? '',
        designation: row.title,
        experience: experience.replace(/ years years/, ' years'),
        qualification,
        primarySkills: skillList(row.primarySkills),
        secondarySkills: skillList(row.secondarySkills),
        salaryBudget: row.salaryBand ?? '',
        hireCategory: row.hireCategory ?? '',
        hireType: row.hireType ?? '',
        jobDescription: row.jobDescription || row.description || '',
        hiringStage: row.hiringStage ?? '',
        portalUrl: `${env.clientOrigin.replace(/\/$/, '')}/requirements/${row.id}`,
        ...extra,
    };
    let recruiterIds = [];
    try {
        const parsed = JSON.parse(row.recruiters || '[]');
        const pending = JSON.parse(row.pendingRecruiters || '[]');
        recruiterIds = [...(Array.isArray(parsed) ? parsed : []), ...(Array.isArray(pending) ? pending : [])];
    }
    catch {
        recruiterIds = [];
    }
    return { row, values, recruiterIds };
}
export function queueWorkflow(work) {
    work
        .then((result) => {
        if (result && typeof result === 'object' && 'sent' in result && result.sent === false) {
            console.error('[workflow-mail] not sent', result);
        }
    })
        .catch((err) => console.error('[workflow-mail]', err instanceof Error ? err.message : err));
}
