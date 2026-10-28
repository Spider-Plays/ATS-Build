import { env } from '../config/env.js';
import { renderEmail } from './layout.js';
import { escapeHtml as esc } from './tokens.js';
const origin = () => env.clientOrigin.replace(/\/$/, '');
const strong = (value) => `<strong>${esc(value)}</strong>`;
function initials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
function linkify(text) {
    return esc(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" style="font-weight:600;text-decoration:none;">${url}</a>`);
}
// ── Accounts ──
/** Role codes whose display name differs from the code (TA_MANAGER is shown as TA Manager). */
const ROLE_DISPLAY_NAMES = {
    TA_MANAGER: 'TA Manager',
};
export function inviteEmail(p) {
    const role = ROLE_DISPLAY_NAMES[p.role.trim().replace(/\s+/g, '_').toUpperCase()] ??
        p.role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return {
        subject: `You're invited to ${env.appName}`,
        html: renderEmail({
            audience: 'staff',
            preheader: `Your ${env.appName} account is ready. Choose your password to get started.`,
            eyebrow: 'Account invite',
            title: `Welcome to ${env.appName}`,
            subtitle: `${role} account`,
            tile: { top: 'NEW', main: initials(role) },
            blocks: [
                { type: 'greeting', name: p.name },
                { type: 'p', html: `You’ve been invited to join ${strong(env.appName)} as ${strong(role)}. Choose your password with the button below, then sign in with ${strong(p.to)}.` },
                { type: 'actions', items: [{ label: 'Set your password', href: p.setupUrl }] },
                { type: 'note', html: 'This link works once and expires in <strong>24 hours</strong>. If it has expired, use <strong>Forgot password</strong> on the sign-in page.' },
                { type: 'fallback', url: p.setupUrl },
            ],
        }),
    };
}
export function vendorInviteEmail(p) {
    const onboardingUrl = `${origin()}/vendor-portal/onboarding`;
    const vendorLabel = p.vendorName?.trim();
    return {
        subject: `Welcome to ${env.appName} vendor portal — complete your onboarding`,
        html: renderEmail({
            audience: 'vendor',
            preheader: 'Your vendor portal login is ready. Choose your password and complete the onboarding form.',
            eyebrow: 'Vendor invite',
            title: 'Welcome to the vendor portal',
            subtitle: vendorLabel || env.appName,
            blocks: [
                { type: 'greeting', name: p.name },
                { type: 'p', html: vendorLabel ? `You’ve been added as a staffing vendor (${strong(vendorLabel)}) on ${strong(env.appName)}.` : `You’ve been added as a staffing vendor on ${strong(env.appName)}.` },
                { type: 'actions', items: [{ label: 'Set your password', href: p.setupUrl }, { label: 'Onboarding form', href: onboardingUrl, variant: 'secondary' }] },
                { type: 'steps', title: 'Next steps', items: [
                        `Choose your password with the button above, then sign in with ${strong(p.to)}.`,
                        'Complete the <strong>Vendor Onboarding</strong> and <strong>Vendor Evaluation</strong> forms.',
                        'HR reviews your submission and unlocks full portal access.',
                    ] },
                { type: 'note', html: 'This link works once and expires in <strong>24 hours</strong>. If it has expired, use <strong>Forgot password</strong> on the sign-in page.' },
                { type: 'fallback', url: p.setupUrl },
            ],
        }),
    };
}
/** Notice only: the admin shares the new password in person, never by email. */
export function adminPasswordEmail(p) {
    const loginUrl = `${origin()}/staffportal`;
    const action = p.setByAdmin ? 'reset' : 'updated';
    return {
        subject: `Your ${env.appName} password was reset`,
        html: renderEmail({
            audience: 'staff',
            preheader: `An administrator ${action} your ${env.appName} password.`,
            eyebrow: 'Security',
            title: 'Your password was reset',
            subtitle: `By an administrator`,
            tile: { main: '&#8635;' },
            blocks: [
                { type: 'greeting', name: p.name },
                { type: 'p', html: `An administrator ${action} your account password. They will share the temporary password with you directly, and you will choose your own when you sign in.` },
                { type: 'actions', items: [{ label: `Sign in to ${env.appName}`, href: loginUrl }] },
                { type: 'note', html: 'Did not expect this? Contact your administrator, or use <strong>Forgot password</strong> on the sign-in page to choose a new password yourself.' },
            ],
        }),
    };
}
export function passwordResetEmail(p) {
    return {
        subject: `Reset your ${env.appName} password`,
        html: renderEmail({
            audience: 'staff',
            preheader: `Reset your ${env.appName} password. The link expires in 1 hour.`,
            eyebrow: 'Security',
            title: 'Reset your password',
            subtitle: 'This link expires in 1 hour',
            tile: { main: '&#8635;' },
            blocks: [
                { type: 'greeting', name: p.name },
                { type: 'p', html: 'We received a request to reset your password. Choose a new one with the button below.' },
                { type: 'actions', items: [{ label: 'Reset password', href: p.resetUrl }] },
                { type: 'fallback', url: p.resetUrl },
                { type: 'note', html: 'Didn’t ask for this? You can ignore this email and your password stays the same.' },
            ],
        }),
    };
}
export function interviewCandidateEmail(p) {
    const copy = {
        scheduled: { subject: `Interview scheduled — ${env.appName}`, eyebrow: 'Interview scheduled', title: 'Your interview is confirmed', lead: 'has been scheduled' },
        updated: { subject: `Interview updated — ${env.appName}`, eyebrow: 'Interview updated', title: 'Your interview details changed', lead: 'has updated details' },
        rescheduled: { subject: `Interview rescheduled — ${env.appName}`, eyebrow: 'Interview rescheduled', title: 'Your interview has a new time', lead: 'has been moved to a new time' },
    }[p.change];
    return {
        subject: copy.subject,
        html: renderEmail({
            audience: 'candidate',
            preheader: `Your ${p.type} interview is scheduled for ${p.scheduledAt}.`,
            eyebrow: copy.eyebrow,
            title: copy.title,
            subtitle: `${p.type} · ${p.scheduledAt}`,
            blocks: [
                { type: 'greeting', name: p.candidateName },
                { type: 'p', html: `Your ${strong(p.type)} interview ${copy.lead}.` },
                { type: 'details', rows: [['Interview type', p.type], ['Date & time', p.scheduledAt], ...(p.location ? [['Location', p.location]] : [])] },
                { type: 'actions', items: [
                        ...(p.meetingLink ? [{ label: 'Join meeting', href: p.meetingLink }] : []),
                        { label: 'Open candidate portal', href: `${origin()}/login`, variant: p.meetingLink ? 'secondary' : 'primary' },
                    ] },
                { type: 'note', html: 'A calendar invite is attached. Accept it to block this time on your Google or Microsoft calendar.' },
            ],
        }),
    };
}
export function interviewerAssignedEmail(p) {
    return {
        subject: `${p.headline} — ${env.appName}`,
        html: renderEmail({
            audience: 'staff',
            preheader: `You’re on the panel for ${p.candidateName}, ${p.scheduledAt}.`,
            eyebrow: 'Interview panel',
            title: p.headline,
            subtitle: `${p.candidateName} · ${p.type}`,
            tile: { top: 'PANEL', main: initials(p.candidateName) },
            blocks: [
                { type: 'greeting', name: p.recipientName },
                { type: 'p', html: `You are assigned to interview ${strong(p.candidateName)}.` },
                { type: 'details', rows: [['Candidate', p.candidateName], ['Interview type', p.type], ['Date & time', p.scheduledAt], ...(p.location ? [['Location', p.location]] : [])] },
                { type: 'actions', items: [
                        ...(p.meetingLink ? [{ label: 'Join meeting', href: p.meetingLink }] : []),
                        { label: `Open in ${env.appName}`, href: `${origin()}/interviews`, variant: p.meetingLink ? 'secondary' : 'primary' },
                    ] },
                { type: 'note', html: 'A calendar invite is attached. Accept it to block this time on your Google or Microsoft calendar.' },
            ],
        }),
    };
}
export function interviewCancelledEmail(p) {
    return {
        subject: `Interview cancelled — ${env.appName}`,
        html: renderEmail({
            audience: p.audience,
            preheader: `The ${p.type} interview on ${p.scheduledAt} has been cancelled.`,
            eyebrow: 'Interview cancelled',
            title: p.audience === 'candidate' ? 'Your interview has been cancelled' : 'Interview cancelled',
            subtitle: p.candidateName ? `${p.candidateName} · ${p.type}` : p.type,
            tile: { main: '&#10005;' },
            blocks: [
                { type: 'greeting', name: p.recipientName },
                { type: 'p', html: `The ${strong(p.type)} interview scheduled for ${strong(p.scheduledAt)} has been cancelled.` },
                p.candidateName ? { type: 'details', rows: [['Candidate', p.candidateName]] } : null,
                p.audience === 'candidate'
                    ? { type: 'callout', tone: 'neutral', title: 'Your calendar will update automatically', html: 'The attached calendar update removes the event. Your recruiter will be in touch about next steps.' }
                    : { type: 'note', html: 'The attached calendar update removes the event from your calendar.' },
            ],
        }),
    };
}
export function interviewReminderEmail(p) {
    const label = p.hoursUntil >= 2 ? `${p.hoursUntil} hours` : '1 hour';
    const rows = [['Interview type', p.type], ['Starts in', label], ['Date & time', p.scheduledAt]];
    if (p.candidateName)
        rows.push(['Candidate', p.candidateName]);
    if (p.location)
        rows.push(['Location', p.location]);
    const portal = p.audience === 'candidate' ? `${origin()}/login` : `${origin()}/interviews`;
    return {
        subject: `Interview reminder (${label}) — ${env.appName}`,
        html: renderEmail({
            audience: p.audience,
            preheader: `Your ${p.type} interview starts in about ${label}.`,
            eyebrow: `Starts in ${label}`,
            title: p.audience === 'candidate' ? 'Your interview is coming up' : 'Interview coming up',
            subtitle: p.candidateName ? `${p.candidateName} · ${p.type}` : p.type,
            tile: { top: 'IN', main: p.hoursUntil >= 2 ? `${p.hoursUntil}h` : '1h' },
            blocks: [
                { type: 'greeting', name: p.recipientName },
                { type: 'p', html: `A quick reminder: a ${strong(p.type)} interview is coming up in about ${strong(label)}.` },
                { type: 'details', rows },
                { type: 'actions', items: [
                        ...(p.meetingLink ? [{ label: 'Join meeting', href: p.meetingLink }] : []),
                        { label: p.audience === 'candidate' ? 'Open candidate portal' : 'View resume & JD', href: portal, variant: p.meetingLink ? 'secondary' : 'primary' },
                    ] },
            ],
        }),
    };
}
// ── Offers ──
export function offerSentEmail(p) {
    const ctc = p.annualCtc.toLocaleString('en-IN');
    const respondBy = p.validUntil ? new Date(p.validUntil).toLocaleDateString('en-IN') : '';
    return {
        subject: `Congratulations — your offer from ${env.appName}`,
        html: renderEmail({
            audience: 'candidate',
            preheader: 'Congratulations! Your offer letter is ready in the candidate portal.',
            eyebrow: 'Offer extended',
            title: `Congratulations, ${p.candidateName.split(/\s+/)[0]}!`,
            subtitle: 'Your offer letter is ready',
            blocks: [
                { type: 'p', html: 'We’re delighted to extend an offer to you. Review it in the candidate portal and accept or decline online.' },
                { type: 'highlight', label: 'Your offer', title: `Annual CTC Rs. ${ctc}/-`, facts: respondBy ? [['Respond by', respondBy]] : [] },
                { type: 'p', html: p.setupUrl
                        ? `We created a candidate portal account for you. Choose your password with the button below, then sign in with ${strong(p.to)}.`
                        : `Sign in to your candidate portal with ${strong(p.to)} to review your offer.` },
                { type: 'actions', items: [{ label: p.setupUrl ? 'Set your password' : 'Sign in & view offer', href: p.setupUrl ?? p.portalLoginUrl }, { label: 'View offer letter', href: p.portalOfferUrl, variant: 'secondary' }] },
                ...(p.setupUrl ? [{ type: 'note', html: 'This link works once and expires in <strong>24 hours</strong>. If it has expired, use <strong>Forgot password</strong> on the sign-in page.' }] : []),
                { type: 'fallback', url: p.setupUrl ?? p.portalLoginUrl },
            ],
        }),
    };
}
export function offerOutcomeEmail(p) {
    const word = p.accepted ? 'accepted' : 'declined';
    return {
        subject: `Offer ${word} — ${p.candidateName}`,
        html: renderEmail({
            audience: 'staff',
            preheader: `${p.candidateName} has ${word} the offer for ${p.jobTitle}.`,
            eyebrow: `Offer ${word}`,
            title: `${p.candidateName} ${word} the offer`,
            subtitle: p.jobTitle,
            tile: { main: p.accepted ? '&#10003;' : '&#10005;' },
            blocks: [
                { type: 'greeting', name: p.recipientName },
                { type: 'person', initials: initials(p.candidateName), name: p.candidateName, meta: p.jobTitle, chips: [{ tone: p.accepted ? 'success' : 'error', label: `Offer ${word}` }] },
                { type: 'details', rows: [[p.accepted ? 'Base salary' : 'Base salary offered', p.baseSalary.toLocaleString()]] },
                { type: 'actions', items: [{ label: 'View offers', href: `${origin()}/offers` }] },
            ],
        }),
    };
}
// ── Candidates ──
const CANDIDATE_STATUS_MESSAGES = {
    TO_BE_SCREENED: 'Your profile has been received and is under review for this role.',
    SCREEN_SELECT: 'You have been shortlisted for further review.',
    SCREEN_REJECT: 'Thank you for your interest. After careful review, we will not be moving forward at this time.',
    L1_INTERVIEW: 'You have been moved to the interview stage.',
    L1_INTERVIEW_REJECT: 'Thank you for your interest. After careful review, we will not be moving forward at this time.',
    MANAGERIAL_INTERVIEW: 'You have been moved to the managerial interview stage.',
    MANAGERIAL_INTERVIEW_REJECT: 'Thank you for your interest. After careful review, we will not be moving forward at this time.',
    CLIENT_INTERVIEW: 'You have been moved to the client interview stage.',
    CLIENT_INTERVIEW_REJECT: 'Thank you for your interest. After careful review, we will not be moving forward at this time.',
    HR_INTERVIEW: 'You have been moved to the HR interview stage.',
    HR_INTERVIEW_SELECT: 'You have been selected after the HR interview.',
    HR_INTERVIEW_REJECT: 'Thank you for your interest. After careful review, we will not be moving forward at this time.',
    TO_BE_OFFERED: 'Congratulations — your application has progressed to the offer stage.',
    OFFERED: 'Congratulations — an offer has been extended for this role.',
    OFFER_ACCEPTED: 'Thank you for accepting the offer. We look forward to having you on board.',
    POSITION_ABORT: 'This position is no longer open. Thank you for your interest.',
    OFFER_DECLINED: 'We have recorded that the offer was declined.',
    CANDIDATE_ABORT: 'Your application has been withdrawn from this role.',
    JOINED: 'Congratulations — you have joined. Welcome aboard!',
    BANK: 'Your profile has been moved to our talent bank for future opportunities.',
    ON_HOLD: 'Your application is currently on hold.',
};
/** Progress stage per status; statuses not listed (rejections, holds) show no stage bar. */
const CANDIDATE_STAGE = {
    TO_BE_SCREENED: 1, SCREEN_SELECT: 1,
    L1_INTERVIEW: 2, MANAGERIAL_INTERVIEW: 2, CLIENT_INTERVIEW: 2, HR_INTERVIEW: 2, HR_INTERVIEW_SELECT: 2,
    TO_BE_OFFERED: 3, OFFERED: 3, OFFER_ACCEPTED: 3,
    JOINED: 4,
};
function candidateStatusTitle(status) {
    if (status === 'JOINED')
        return 'Welcome aboard!';
    if (status === 'TO_BE_SCREENED')
        return 'We’ve received your application';
    const stage = CANDIDATE_STAGE[status];
    if (stage === 3)
        return 'Great news about your application';
    if (stage !== undefined)
        return 'Your application has moved forward';
    return 'An update on your application';
}
export function candidateStatusEmail(p) {
    const message = CANDIDATE_STATUS_MESSAGES[p.status] ?? 'Your application status has been updated.';
    const stage = CANDIDATE_STAGE[p.status];
    return {
        subject: `Application update — ${env.appName}`,
        html: renderEmail({
            audience: 'candidate',
            preheader: message,
            eyebrow: 'Application update',
            title: candidateStatusTitle(p.status),
            subtitle: p.jobTitle,
            blocks: [
                { type: 'greeting', name: p.candidateName },
                { type: 'p', html: esc(message) },
                stage !== undefined
                    ? { type: 'stepper', steps: ['Applied', 'Screening', 'Interview', 'Offer', 'Joined'], current: stage }
                    : { type: 'details', rows: [['Role', p.jobTitle], ['Status', p.status.replace(/_/g, ' ')]] },
                { type: 'actions', items: [{ label: 'View candidate portal', href: `${origin()}/login` }] },
            ],
        }),
    };
}
export function jobDescriptionEmail(p) {
    const rows = [['Role', p.jobTitle]];
    if (p.client)
        rows.push(['Client', p.client]);
    if (p.jobCode)
        rows.push(['Job code', p.jobCode]);
    return {
        subject: `Job description — ${p.jobTitle} — ${env.appName}`,
        html: renderEmail({
            audience: 'candidate',
            preheader: `The job description for ${p.jobTitle}.`,
            eyebrow: 'Job description',
            title: p.jobTitle,
            subtitle: [p.client, p.jobCode].filter(Boolean).join(' · ') || undefined,
            blocks: [
                { type: 'greeting', name: p.candidateName },
                { type: 'p', html: `Please find the job description for ${strong(p.jobTitle)} below.` },
                { type: 'details', rows },
                { type: 'document', label: 'Job description', text: p.jobDescription },
                { type: 'actions', items: [{ label: 'Open candidate portal', href: `${origin()}/login` }] },
            ],
        }),
    };
}
export function newCandidateNotificationEmail(p) {
    const submittedBy = p.submittedBy ?? p.vendorName ?? p.referrerName;
    const role = `${p.jobTitle}${p.jobCode ? ` · ${p.jobCode}` : ''}`;
    return {
        subject: `New candidate — ${p.candidateName}`,
        html: renderEmail({
            audience: 'staff',
            preheader: `A new profile for ${p.jobTitle} is ready for review.`,
            eyebrow: 'New candidate',
            title: 'New candidate submitted',
            subtitle: role,
            tile: { top: 'NEW', main: initials(p.candidateName) },
            blocks: [
                { type: 'greeting', name: p.recipientName },
                { type: 'p', html: 'A new candidate profile is ready for review.' },
                { type: 'person', initials: initials(p.candidateName), name: p.candidateName, meta: p.candidateEmail, chips: [{ tone: 'info', label: p.source }] },
                { type: 'details', rows: [['Role', role], ['Source', p.source], ...(submittedBy ? [['Submitted by', submittedBy]] : [])] },
                { type: 'actions', items: [{ label: 'Review profile', href: `${origin()}/candidates` }] },
            ],
        }),
    };
}
// ── Referrals ──
export function referralSubmittedEmail(p) {
    const portalUrl = `${origin()}/referral-portal/login`;
    return {
        subject: `Referral submitted — ${env.appName}`,
        html: renderEmail({
            audience: 'referral',
            preheader: `Thanks for referring ${p.candidateName} for ${p.jobTitle}.`,
            eyebrow: 'Referral submitted',
            title: 'Thanks for your referral',
            subtitle: `${p.candidateName} · ${p.jobTitle}`,
            blocks: [
                { type: 'greeting', name: p.referrerName },
                { type: 'p', html: `Your referral for ${strong(p.candidateName)} has been submitted for ${strong(p.jobTitle)}${p.jobCode ? ` (${esc(p.jobCode)})` : ''}.` },
                { type: 'stepper', steps: ['Referred', 'Screening', 'Interview', 'Offer', 'Joined'], current: 0 },
                { type: 'p', html: 'We’ll let you know when their status changes.' },
                { type: 'actions', items: [{ label: 'View referral portal', href: portalUrl }] },
            ],
        }),
    };
}
export function referralStatusEmail(p) {
    const joined = p.status === 'JOINED' || p.status === 'HIRED';
    const headline = joined ? 'Referral joined' : 'Referral update';
    return {
        subject: `${headline} — ${env.appName}`,
        html: renderEmail({
            audience: 'referral',
            preheader: joined ? `Great news. ${p.candidateName} has joined.` : `An update on your referral for ${p.jobTitle}.`,
            eyebrow: headline,
            title: joined ? `${p.candidateName} has joined IGS` : 'An update on your referral',
            subtitle: `${p.candidateName} · ${p.jobTitle}`,
            blocks: [
                { type: 'greeting', name: p.referrerName },
                joined
                    ? { type: 'p', html: `Great news — ${strong(p.candidateName)} has joined for ${strong(p.jobTitle)}. Thank you for the referral.` }
                    : { type: 'p', html: `${strong(p.candidateName)}’s application for ${strong(p.jobTitle)} was not selected.` },
                joined
                    ? { type: 'person', initials: initials(p.candidateName), name: p.candidateName, meta: p.jobTitle, chips: [{ tone: 'success', label: 'Joined' }] }
                    : { type: 'callout', tone: 'neutral', title: 'Keep them coming', html: 'Thank you for thinking of us. Good referrals are how we find great people.' },
                { type: 'actions', items: [{ label: 'View referral portal', href: `${origin()}/referral-portal/login` }] },
            ],
        }),
    };
}
// ── Vendors ──
export function vendorAssignmentEmail(p) {
    const portalUrl = `${origin()}/staffportal`;
    const count = p.requirements.length;
    return {
        subject: `New job assignments — ${env.appName}`,
        html: renderEmail({
            audience: 'vendor',
            preheader: `${p.vendorName} has been assigned to ${count} open role${count === 1 ? '' : 's'}.`,
            eyebrow: 'New assignments',
            title: `${count} new role${count === 1 ? '' : 's'} assigned to you`,
            subtitle: p.vendorName,
            blocks: [
                { type: 'greeting', name: p.recipientName },
                { type: 'p', html: `${strong(p.vendorName)} has been assigned to the following open roles:` },
                { type: 'list', items: p.requirements.map((r) => ({ text: r.title, sub: r.jobCode ?? '' })) },
                { type: 'actions', items: [{ label: 'Open vendor portal', href: portalUrl }] },
                { type: 'fallback', url: portalUrl },
            ],
        }),
    };
}
// ── Staff notifications & reports ──
export function staffNotificationEmail(p) {
    return {
        subject: p.subject,
        html: renderEmail({
            audience: p.audience ?? 'staff',
            preheader: p.body.slice(0, 140),
            eyebrow: 'Notification',
            title: p.headline,
            tile: { main: '!' },
            blocks: [
                { type: 'greeting', name: p.recipientName },
                { type: 'p', html: linkify(p.body) },
            ],
        }),
    };
}
export function requirementAgingAlertEmail(p) {
    const headline = p.threshold === 40 ? 'Requirement aging — 40 days' : 'Requirement aging — 20 days';
    const tone = p.threshold === 40 ? 'error' : 'warning';
    return {
        subject: p.subject || `${headline}: ${p.title}`,
        html: renderEmail({
            audience: 'staff',
            preheader: `${p.title} has been open ${p.daysOpen} days since approval and is still not closed.`,
            eyebrow: 'Requirement aging',
            title: `${p.title} is ${p.threshold}+ days old`,
            subtitle: [p.jobCode, `open ${p.daysOpen} calendar days`].filter(Boolean).join(' · '),
            tile: { top: 'DAYS', main: String(p.daysOpen) },
            blocks: [
                { type: 'greeting', name: p.recipientName },
                { type: 'p', html: `The requirement ${strong(p.title)}${p.jobCode ? ` (${esc(p.jobCode)})` : ''} has crossed ${strong(`${p.threshold} days`)} since approval and is still not closed.` },
                { type: 'stats', items: [{ value: String(p.daysOpen), label: 'Days open', tone }, { value: String(p.threshold), label: 'Threshold (days)' }] },
                { type: 'actions', items: [{ label: 'View requirement', href: p.requirementUrl }] },
                { type: 'note', html: 'Ageing starts when a requirement is approved. Please review sourcing progress and next steps with the hiring team.' },
            ],
        }),
    };
}
