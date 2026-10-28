import { Resend } from 'resend';
import { env } from '../config/env.js';
import { emailBrandLockupHtml, getEmailBrandInlineAttachments, } from '../lib/emailBrandAssets.js';
import { isM365EmailConfigured, sendM365HtmlEmail } from '../integrations/m365/index.js';
import { isEmailKindEnabled } from '../lib/emailToggles.js';
import { emailCopyLabel, fillEmailCopy, getEmailCopies, resolveEmailWording } from '../lib/emailCopy.js';
import { emailsForRoleSlots } from '../lib/emailRecipients.js';
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
const EMAIL_BRAND = {
    primary: '#1266c4',
    primaryDark: '#0d4d96',
    primaryLight: '#e8f2ff',
    text: '#1a2b3c',
    textMuted: '#64748b',
    border: '#e2e8f0',
    bg: '#f0f5fa',
    white: '#ffffff',
    /** Mark chip on dark header — matches StitchLogo inverse onDark (white/12 on primary). */
    markChipBg: '#2e76cc',
    wordmarkSuffix: '#cce0f5',
};
/** Matches the staff sidebar lockup: Stitch mark + wordmark + IGS. */
function emailStitchLogo() {
    return emailBrandLockupHtml({ subtitle: 'Creating Impact' });
}
/**
 * Bulletproof CTA. Classic Outlook ignores border-radius, so it gets a VML roundrect
 * (fixed size, sized from the label); every other client gets the CSS button.
 */
function emailButton(href, label) {
    const safeHref = escapeHtml(href);
    const safeLabel = escapeHtml(label);
    const width = Math.ceil([...label].length * 13 * 0.6) + 28;
    return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:28px 0 0;">
    <tr>
      <td align="left">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" arcsize="19%" fillcolor="${EMAIL_BRAND.primary}" stroked="f" style="height:32px;v-text-anchor:middle;width:${width}px;">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:bold;">${safeLabel}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <table cellpadding="0" cellspacing="0" border="0" role="presentation">
          <tr>
            <td align="center" bgcolor="${EMAIL_BRAND.primary}" style="background-color:${EMAIL_BRAND.primary};border-radius:6px;">
              <a href="${safeHref}" target="_blank" style="display:inline-block;padding:8px 14px;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;line-height:16px;color:#ffffff;text-decoration:none;border-radius:6px;background-color:${EMAIL_BRAND.primary};white-space:nowrap;">${safeLabel}</a>
            </td>
          </tr>
        </table>
        <!--<![endif]-->
      </td>
    </tr>
  </table>`;
}
/** Visible copy-paste URL under a CTA — some clients break the button. */
function emailFallbackUrl(href) {
    const safeHref = escapeHtml(href);
    return `<p style="margin:16px 0 0;font-size:13px;color:${EMAIL_BRAND.textMuted};line-height:1.6;word-break:break-all;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    If the button does not open, copy this link into your browser:<br/>
    <a href="${safeHref}" target="_blank" style="color:${EMAIL_BRAND.primary};font-weight:600;text-decoration:none;">${safeHref}</a>
  </p>`;
}
const SETUP_LINK_NOTE = 'This link works once and expires in <strong>24 hours</strong>. If it has expired, use <strong>Forgot password</strong> on the sign-in page.';
function detailBox(fields) {
    const rows = fields
        .map((field, index) => {
        const valueHtml = field.mono
            ? `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:4px;">
            <tr>
              <td bgcolor="${EMAIL_BRAND.white}" style="background-color:${EMAIL_BRAND.white};padding:10px 14px;border:1px dashed ${EMAIL_BRAND.primary};font-family:Consolas,Monaco,monospace;font-size:16px;font-weight:600;color:${EMAIL_BRAND.primary};letter-spacing:0.04em;-webkit-user-select:all;user-select:all;">${escapeHtml(field.value)}</td>
            </tr>
          </table>${field.selectToCopyHint
                ? `<p style="margin:6px 0 0;font-size:12px;color:${EMAIL_BRAND.textMuted};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Click the password to select it, then press <strong>Ctrl+C</strong> (Mac: <strong>⌘C</strong>) to copy.</p>`
                : ''}`
            : `<p style="margin:0;font-size:15px;color:${EMAIL_BRAND.text};font-weight:500;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(field.value)}</p>`;
        return `
        <p style="margin:${index > 0 ? '16px' : '0'} 0 4px;font-size:11px;font-weight:600;color:${EMAIL_BRAND.textMuted};text-transform:uppercase;letter-spacing:0.05em;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(field.label)}</p>
        ${valueHtml}
      `;
    })
        .join('');
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="${EMAIL_BRAND.bg}" style="background-color:${EMAIL_BRAND.bg};border:1px solid ${EMAIL_BRAND.border};">
    <tr><td style="padding:20px 24px;">${rows}</td></tr>
  </table>`;
}
function emailGreeting(name) {
    return `<p style="margin:0 0 8px;font-size:16px;color:${EMAIL_BRAND.text};line-height:1.6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Hi <strong>${escapeHtml(name)}</strong>,</p>`;
}
function emailLead(html) {
    return `<p style="margin:0 0 24px;font-size:15px;color:${EMAIL_BRAND.textMuted};line-height:1.6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${html}</p>`;
}
function emailParagraph(html) {
    return `<p style="margin:0 0 16px;font-size:15px;color:${EMAIL_BRAND.textMuted};line-height:1.6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${html}</p>`;
}
function emailNote(html) {
    return `<p style="margin:16px 0 0;font-size:13px;color:${EMAIL_BRAND.textMuted};line-height:1.5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${html}</p>`;
}
function emailBadge(label) {
    return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:24px;">
    <tr>
      <td bgcolor="${EMAIL_BRAND.primaryLight}" style="background-color:${EMAIL_BRAND.primaryLight};padding:6px 14px;">
        <span style="font-size:12px;font-weight:700;color:${EMAIL_BRAND.primary};text-transform:uppercase;letter-spacing:0.06em;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(label)}</span>
      </td>
    </tr>
  </table>`;
}
function emailLink(href, label) {
    return `<a href="${escapeHtml(href)}" target="_blank" style="color:${EMAIL_BRAND.primary};font-weight:600;text-decoration:none;">${escapeHtml(label)}</a>`;
}
export function emailShell(params) {
    const appName = escapeHtml(env.appName);
    const headerTitle = escapeHtml(params.headerTitle);
    const preheader = params.preheader
        ? `<div style="display:none;font-size:1px;color:${EMAIL_BRAND.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(params.preheader)}</div>`
        : '';
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_BRAND.bg};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
  ${preheader}
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="${EMAIL_BRAND.bg}" style="background-color:${EMAIL_BRAND.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;max-width:560px;">
          <tr>
            <td align="left" bgcolor="${EMAIL_BRAND.primary}" style="background-color:${EMAIL_BRAND.primary};padding:32px 36px;">
              ${emailStitchLogo()}
              <p style="margin:20px 0 0;font-size:26px;font-weight:700;color:#ffffff;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.3;letter-spacing:-0.02em;">${headerTitle}</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="${EMAIL_BRAND.white}" style="background-color:${EMAIL_BRAND.white};padding:36px;border:1px solid ${EMAIL_BRAND.border};border-top:none;">
              ${params.content}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 16px 0;text-align:center;">
              <p style="margin:0;font-size:12px;color:${EMAIL_BRAND.textMuted};line-height:1.6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                ${appName} · Talent Acquisition Platform<br/>
                <a href="mailto:talentacquisition@ats.igsglobal.co" style="color:${EMAIL_BRAND.primary};text-decoration:none;font-weight:600;">talentacquisition@ats.igsglobal.co</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
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
export function isEmailConfigured() {
    return isM365EmailConfigured() || Boolean(env.resendApiKey);
}
/** Prefix QA staging subjects so test mail is easy to spot in inboxes. */
function formatEmailSubject(subject) {
    if (process.env.ATS_ENV !== 'staging')
        return subject;
    return subject.startsWith('[QA] ') ? subject : `[QA] ${subject}`;
}
export async function sendHtmlEmail(params) {
    if (params.kind && !params.force && !(await isEmailKindEnabled(params.kind))) {
        return { sent: false, reason: 'disabled' };
    }
    let subjectText = params.subject;
    let html = params.html;
    let to = params.to;
    let cc = params.cc;
    let bcc = params.bcc;
    if (params.kind && !params.force) {
        const copy = (await getEmailCopies())[params.kind];
        const merge = (base, extra) => {
            const seen = new Set();
            const out = [];
            for (const item of [...(base ?? []), ...extra]) {
                const email = item.trim().toLowerCase();
                if (!email || seen.has(email))
                    continue;
                seen.add(email);
                out.push(email);
            }
            return out;
        };
        const baseTo = Array.isArray(params.to) ? params.to : [params.to];
        const [toSlots, ccSlots, bccSlots] = await Promise.all([
            emailsForRoleSlots(copy.to, params.vendorId),
            emailsForRoleSlots(copy.cc, params.vendorId),
            emailsForRoleSlots(copy.bcc, params.vendorId),
        ]);
        to = merge(baseTo, [...toSlots, ...(copy.extraTo ?? [])]);
        cc = merge(params.cc, [...ccSlots, ...(copy.extraCc ?? [])]);
        bcc = merge(params.bcc, [...bccSlots, ...copy.extraBcc]);
        const wording = await resolveEmailWording(params.kind, { subject: params.subject, html: params.html }, params.vars);
        subjectText = wording.subject;
        // A custom body that leaves out the set-password link (older saved wording used
        // {{tempPassword}}) would strand the recipient, so the standard email is sent instead.
        const dropsSetupLink = Boolean(params.vars?.setupUrl) && !copy.body.includes('{{setupUrl}}');
        if (wording.bodyChanged && !dropsSetupLink) {
            const filledBody = fillEmailCopy(copy, params.vars ?? {}).body;
            const note = emailShell({
                headerTitle: emailCopyLabel(params.kind),
                content: `<p style="margin:0;white-space:pre-wrap;">${escapeHtml(filledBody)}</p>`,
            });
            html = params.kind === 'openRequisitionReport' ? `${note}${params.html}` : note;
        }
    }
    const subject = formatEmailSubject(subjectText);
    const inlineAttachments = getEmailBrandInlineAttachments(html);
    if (isM365EmailConfigured()) {
        return sendM365HtmlEmail({ ...params, to, cc, bcc, subject, html, inlineAttachments });
    }
    if (!env.resendApiKey)
        return { sent: false, reason: 'not_configured' };
    const resend = new Resend(env.resendApiKey);
    try {
        const { data, error } = await resend.emails.send({
            from: env.emailFrom,
            to,
            ...(cc?.length ? { cc } : {}),
            ...(bcc?.length ? { bcc } : {}),
            subject,
            html,
            attachments: [
                ...inlineAttachments.map((item) => ({
                    filename: item.filename,
                    content: item.content,
                    contentType: item.contentType,
                    contentId: item.cid,
                })),
                ...(params.attachments?.map((item) => ({
                    filename: item.filename,
                    content: item.content,
                })) ?? []),
            ],
        });
        if (error)
            return { sent: false, reason: 'error', message: error.message };
        return { sent: true, id: data?.id ?? 'unknown' };
    }
    catch (e) {
        return { sent: false, reason: 'error', message: e instanceof Error ? e.message : 'Failed to send email' };
    }
}
/** Staff invite. Carries a single-use link to choose a password; no password is ever emailed. */
export async function sendInviteEmail(params) {
    if (params.role === 'VENDOR') {
        return sendVendorInviteEmail({ to: params.to, name: params.name, setupUrl: params.setupUrl });
    }
    return sendHtmlEmail({
        kind: 'invite',
        vars: { name: params.name, role: params.role, setupUrl: params.setupUrl, appName: env.appName },
        to: params.to,
        subject: `You're invited to ${env.appName}`,
        html: emailShell({
            preheader: `Your ${env.appName} account is ready. Choose your password to get started.`,
            headerTitle: "You're invited!",
            content: `
        ${emailGreeting(params.name)}
        ${emailLead(`You've been invited to join <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(env.appName)}</strong>. Choose your password with the button below, then sign in with <strong>${escapeHtml(params.to)}</strong>.`)}
        ${emailBadge(params.role)}
        ${emailButton(params.setupUrl, 'Set your password')}
        ${emailFallbackUrl(params.setupUrl)}
        ${emailNote(SETUP_LINK_NOTE)}
      `,
        }),
    });
}
/** Portal invite for a newly created vendor: set-password link plus onboarding instructions. */
export async function sendVendorInviteEmail(params) {
    const origin = env.clientOrigin.replace(/\/$/, '');
    const onboardingUrl = `${origin}/vendor-portal/onboarding`;
    const vendorLabel = params.vendorName?.trim();
    return sendHtmlEmail({
        kind: 'vendorInvite',
        vendorId: params.vendorId,
        vars: { name: params.name, setupUrl: params.setupUrl, appName: env.appName },
        to: params.to,
        subject: `Welcome to ${env.appName} vendor portal — complete your onboarding`,
        html: emailShell({
            preheader: 'Your vendor portal login is ready. Choose your password and complete the onboarding form.',
            headerTitle: 'Vendor portal invite',
            content: `
        ${emailGreeting(params.name)}
        ${emailLead(vendorLabel
                ? `You've been added as a staffing vendor (<strong style="color:${EMAIL_BRAND.text};">${escapeHtml(vendorLabel)}</strong>) on <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(env.appName)}</strong>.`
                : `You've been added as a staffing vendor on <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(env.appName)}</strong>.`)}
        ${emailLead(`Choose your password with the button below, then sign in with <strong>${escapeHtml(params.to)}</strong>. After login, please complete the <strong>Vendor Onboarding</strong> and <strong>Vendor Evaluation</strong> forms. HR will review your submission before full portal access is unlocked.`)}
        ${emailBadge('VENDOR')}
        ${emailButton(params.setupUrl, 'Set your password')}
        ${emailFallbackUrl(params.setupUrl)}
        ${emailNote(SETUP_LINK_NOTE)}
        <p style="margin:16px 0 0;font-size:13px;color:${EMAIL_BRAND.textMuted};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          After signing in, continue here:
          <a href="${escapeHtml(onboardingUrl)}" style="color:${EMAIL_BRAND.primary};font-weight:600;">Vendor onboarding form</a>
        </p>
      `,
        }),
    });
}
/** Tells the owner an admin changed their password. The admin shares the new one in person, never by email. */
export async function sendAdminPasswordEmail(params) {
    const action = params.setByAdmin ? 'reset' : 'updated';
    const loginUrl = `${env.clientOrigin.replace(/\/$/, '')}/staffportal`;
    return sendHtmlEmail({
        kind: 'adminPasswordReset',
        vars: { name: params.name, appName: env.appName },
        to: params.to,
        subject: `Your ${env.appName} password was reset`,
        html: emailShell({
            preheader: `An administrator ${action} your ${env.appName} password.`,
            headerTitle: 'Password updated',
            content: `
        ${emailGreeting(params.name)}
        ${emailLead(`An administrator ${action} your account password. They will share the temporary password with you directly, and you will choose your own when you sign in.`)}
        ${emailNote('Did not expect this? Contact your administrator, or use <strong>Forgot password</strong> on the sign-in page to choose a new password yourself.')}
        ${emailButton(loginUrl, `Sign in to ${env.appName}`)}
      `,
        }),
    });
}
export async function sendPasswordResetEmail(params) {
    return sendHtmlEmail({
        kind: 'passwordReset',
        vars: { name: params.name, resetUrl: params.resetUrl, appName: env.appName },
        to: params.to,
        subject: `Reset your ${env.appName} password`,
        html: emailShell({
            preheader: `Reset your ${env.appName} password — link expires in 1 hour.`,
            headerTitle: 'Reset your password',
            content: `
        ${emailGreeting(params.name)}
        ${emailLead('We received a request to reset your password. Click the button below to choose a new one. This link expires in <strong>1 hour</strong>.')}
        ${emailButton(params.resetUrl, 'Reset password')}
        ${emailFallbackUrl(params.resetUrl)}
        ${emailNote('If you did not request this, you can safely ignore this email.')}
      `,
        }),
    });
}
export async function sendEmailVerificationEmail(params) {
    return sendHtmlEmail({
        force: true,
        vars: { name: params.name, verifyUrl: params.verifyUrl, appName: env.appName },
        to: params.to,
        subject: `Confirm your email for ${env.appName}`,
        html: emailShell({
            preheader: `Confirm your email to finish creating your ${env.appName} account.`,
            headerTitle: 'Confirm your email',
            content: `
        ${emailGreeting(params.name)}
        ${emailLead('Thanks for registering. Confirm that this email address is yours to finish setting up your account. This link expires in <strong>24 hours</strong>.')}
        ${emailButton(params.verifyUrl, 'Confirm email')}
        ${emailFallbackUrl(params.verifyUrl)}
        ${emailNote('If you did not create an account, you can safely ignore this email.')}
      `,
        }),
    });
}
export async function sendOfferSentEmail(params) {
    const ctc = params.annualCtc.toLocaleString('en-IN');
    const accountNote = params.setupUrl
        ? `We created your candidate portal account so you can review and respond to your offer online. Choose your password with the button below, then sign in with <strong>${escapeHtml(params.to)}</strong>.`
        : `Sign in to your candidate portal with <strong>${escapeHtml(params.to)}</strong> to review and respond to your offer.`;
    const actionUrl = params.setupUrl ?? params.portalLoginUrl;
    return sendHtmlEmail({
        kind: 'offerSent',
        vars: { candidateName: params.candidateName, jobTitle: '', appName: env.appName, portalOfferUrl: params.portalOfferUrl },
        to: params.to,
        subject: `Congratulations — your offer from ${env.appName}`,
        html: emailShell({
            preheader: 'Congratulations! Your offer letter is ready in the candidate portal.',
            headerTitle: 'Congratulations!',
            content: `
        ${emailGreeting(params.candidateName)}
        ${emailLead(`We're delighted to extend an offer to you with an annual CTC of <strong style="color:${EMAIL_BRAND.text};">Rs. ${ctc}/-</strong>.`)}
        ${emailParagraph(accountNote)}
        ${params.validUntil ? emailParagraph(`Please respond by <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(new Date(params.validUntil).toLocaleDateString('en-IN'))}</strong>.`) : ''}
        ${emailButton(actionUrl, params.setupUrl ? 'Set your password' : 'Sign in & view offer')}
        ${emailFallbackUrl(actionUrl)}
        ${params.setupUrl ? emailNote(SETUP_LINK_NOTE) : ''}
        ${emailParagraph(`Or open your offer directly after signing in: ${emailLink(params.portalOfferUrl, 'View offer letter')}`)}
      `,
        }),
    });
}
export async function sendOfferAcceptedEmail(params) {
    return sendHtmlEmail({
        kind: 'offerAccepted',
        vars: { recipientName: params.recipientName, candidateName: params.candidateName, jobTitle: params.jobTitle },
        to: params.to,
        subject: `Offer accepted — ${params.candidateName}`,
        html: emailShell({
            headerTitle: 'Offer accepted',
            content: `
        ${emailGreeting(params.recipientName)}
        ${emailLead(`<strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.candidateName)}</strong> has accepted the offer for <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.jobTitle)}</strong>.`)}
        ${detailBox([{ label: 'Base salary', value: params.baseSalary.toLocaleString() }])}
      `,
        }),
    });
}
export async function sendOfferDeclinedEmail(params) {
    return sendHtmlEmail({
        kind: 'offerDeclined',
        vars: { recipientName: params.recipientName, candidateName: params.candidateName, jobTitle: params.jobTitle },
        to: params.to,
        subject: `Offer declined — ${params.candidateName}`,
        html: emailShell({
            headerTitle: 'Offer declined',
            content: `
        ${emailGreeting(params.recipientName)}
        ${emailLead(`<strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.candidateName)}</strong> has declined the offer for <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.jobTitle)}</strong>.`)}
        ${detailBox([{ label: 'Base salary offered', value: params.baseSalary.toLocaleString() }])}
      `,
        }),
    });
}
export async function sendInterviewReminderEmail(params) {
    const label = params.hoursUntil >= 2 ? `${params.hoursUntil} hours` : '1 hour';
    const details = [
        { label: 'Interview type', value: params.type },
        { label: 'Starts in', value: label },
        { label: 'Date & time', value: params.scheduledAt },
    ];
    if (params.candidateName)
        details.push({ label: 'Candidate', value: params.candidateName });
    if (params.location)
        details.push({ label: 'Location', value: params.location });
    return sendHtmlEmail({
        kind: 'interviewReminder',
        vars: { recipientName: params.recipientName, type: params.type, scheduledAt: params.scheduledAt, hoursUntil: String(params.hoursUntil), meetingLink: params.meetingLink, location: params.location, candidateName: params.candidateName },
        to: params.to,
        subject: `Interview reminder (${label}) — ${env.appName}`,
        html: emailShell({
            headerTitle: 'Interview reminder',
            content: `
        ${emailGreeting(params.recipientName)}
        ${emailLead(`Reminder: a <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.type)}</strong> interview is coming up in about <strong style="color:${EMAIL_BRAND.text};">${label}</strong>.`)}
        ${detailBox(details)}
        ${params.meetingLink ? emailParagraph(`${emailLink(params.meetingLink, 'Join meeting')}`) : ''}
      `,
        }),
        attachments: params.calendarInvite
            ? [{ filename: 'interview.ics', contentType: 'text/calendar; method=REQUEST', content: params.calendarInvite }]
            : undefined,
    });
}
export async function sendCandidateStatusEmail(params) {
    const message = CANDIDATE_STATUS_MESSAGES[params.status] ?? 'Your application status has been updated.';
    const portalUrl = `${env.clientOrigin.replace(/\/$/, '')}/login`;
    return sendHtmlEmail({
        kind: 'candidateStatus',
        vars: { candidateName: params.candidateName, jobTitle: params.jobTitle, status: params.status, message, portalUrl },
        to: params.to,
        subject: `Application update — ${env.appName}`,
        html: emailShell({
            headerTitle: 'Application update',
            content: `
        ${emailGreeting(params.candidateName)}
        ${emailLead(message)}
        ${detailBox([
                { label: 'Role', value: params.jobTitle },
                { label: 'Status', value: params.status.replace(/_/g, ' ') },
            ])}
        ${emailButton(portalUrl, 'View candidate portal')}
        ${emailFallbackUrl(portalUrl)}
      `,
        }),
    });
}
function jobDescriptionEmailBlock(text) {
    // Outlook: VML roundrect that grows with the text; others: the CSS box.
    return `<!--[if mso]><div style="height:16px;line-height:16px;font-size:1px;">&nbsp;</div><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" arcsize="1.5%" fillcolor="${EMAIL_BRAND.white}" strokecolor="${EMAIL_BRAND.border}" strokeweight="1px" style="width:872px;"><v:textbox inset="20px,16px,20px,16px" style="mso-fit-shape-to-text:true;"><![endif]-->
  <!--[if !mso]><!--><div style="margin-top:16px;padding:16px 20px;background-color:${EMAIL_BRAND.white};border:1px solid ${EMAIL_BRAND.border};border-radius:8px;"><!--<![endif]-->
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:${EMAIL_BRAND.textMuted};text-transform:uppercase;letter-spacing:0.05em;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">Job description</p>
    <p style="margin:0;font-size:14px;color:${EMAIL_BRAND.text};line-height:1.6;white-space:pre-wrap;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(text)}</p>
  <!--[if !mso]><!--></div><!--<![endif]--><!--[if mso]></v:textbox></v:roundrect><![endif]-->`;
}
export async function sendJobDescriptionEmail(params) {
    const portalUrl = `${env.clientOrigin.replace(/\/$/, '')}/login`;
    const details = [{ label: 'Role', value: params.jobTitle }];
    if (params.client)
        details.push({ label: 'Client', value: params.client });
    if (params.jobCode)
        details.push({ label: 'Job code', value: params.jobCode, mono: true });
    return sendHtmlEmail({
        kind: 'jobDescription',
        vars: { candidateName: params.candidateName, jobTitle: params.jobTitle, client: params.client ?? '', jobCode: params.jobCode ?? '', jobDescription: params.jobDescription },
        to: params.to,
        subject: `Job description — ${params.jobTitle} — ${env.appName}`,
        html: emailShell({
            headerTitle: 'Job description',
            content: `
        ${emailGreeting(params.candidateName)}
        ${emailLead(`Please find the job description for <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.jobTitle)}</strong> below.`)}
        ${detailBox(details)}
        ${jobDescriptionEmailBlock(params.jobDescription)}
        ${emailButton(portalUrl, 'Open candidate portal')}
        ${emailFallbackUrl(portalUrl)}
      `,
        }),
    });
}
export async function sendReferralSubmittedEmail(params) {
    const portalUrl = `${env.clientOrigin.replace(/\/$/, '')}/referral-portal/login`;
    return sendHtmlEmail({
        kind: 'referralSubmitted',
        vars: { referrerName: params.referrerName, candidateName: params.candidateName, jobTitle: params.jobTitle, appName: env.appName },
        to: params.to,
        subject: `Referral submitted — ${env.appName}`,
        html: emailShell({
            headerTitle: 'Referral submitted',
            content: `
        ${emailGreeting(params.referrerName)}
        ${emailLead(`Your referral for <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.candidateName)}</strong> has been submitted for <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.jobTitle)}</strong>${params.jobCode ? ` (${escapeHtml(params.jobCode)})` : ''}.`)}
        ${emailParagraph("We'll notify you when their status changes.")}
        ${emailButton(portalUrl, 'View referral portal')}
        ${emailFallbackUrl(portalUrl)}
      `,
        }),
    });
}
export async function sendReferralStatusEmail(params) {
    const joined = params.status === 'JOINED' || params.status === 'HIRED';
    const headline = joined ? 'Referral joined' : 'Referral update';
    const message = joined
        ? `Great news — ${escapeHtml(params.candidateName)} has joined for ${escapeHtml(params.jobTitle)}.`
        : `${escapeHtml(params.candidateName)}&apos;s application for ${escapeHtml(params.jobTitle)} was not selected.`;
    return sendHtmlEmail({
        kind: 'referralStatus',
        vars: { referrerName: params.referrerName, candidateName: params.candidateName, jobTitle: params.jobTitle, status: params.status },
        to: params.to,
        subject: `${headline} — ${env.appName}`,
        html: emailShell({
            headerTitle: headline,
            content: `
        ${emailGreeting(params.referrerName)}
        ${emailLead(message)}
      `,
        }),
    });
}
export async function sendNewCandidateNotificationEmail(params) {
    const origin = params.submittedBy ?? params.vendorName ?? params.referrerName;
    const details = [
        { label: 'Candidate', value: `${params.candidateName} (${params.candidateEmail})` },
        { label: 'Role', value: `${params.jobTitle}${params.jobCode ? ` · ${params.jobCode}` : ''}` },
        { label: 'Source', value: params.source },
    ];
    if (origin)
        details.push({ label: 'Submitted by', value: origin });
    return sendHtmlEmail({
        kind: 'newCandidate',
        vars: { recipientName: params.recipientName, candidateName: params.candidateName, jobTitle: params.jobTitle ?? '' },
        to: params.to,
        subject: `New candidate — ${params.candidateName}`,
        html: emailShell({
            headerTitle: 'New candidate submitted',
            content: `
        ${emailGreeting(params.recipientName)}
        ${emailLead(`A new candidate profile is ready for review.`)}
        ${detailBox(details)}
        ${emailParagraph(`Sign in to ${escapeHtml(env.appName)} to review the profile.`)}
      `,
        }),
    });
}
export async function sendVendorAssignmentEmail(params) {
    const portalUrl = `${env.clientOrigin.replace(/\/$/, '')}/staffportal`;
    const list = params.requirements
        .map((r) => `<li style="margin-bottom:8px;font-size:15px;color:${EMAIL_BRAND.text};font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(r.title)}${r.jobCode ? ` (${escapeHtml(r.jobCode)})` : ''}</li>`)
        .join('');
    return sendHtmlEmail({
        kind: 'vendorAssignment',
        vendorId: params.vendorId,
        vars: { recipientName: params.recipientName, vendorName: params.vendorName, roles: params.requirements.map((r) => r.title).join(', '), portalUrl },
        to: params.to,
        subject: `New job assignments — ${env.appName}`,
        html: emailShell({
            headerTitle: 'New assignments',
            content: `
        ${emailGreeting(params.recipientName)}
        ${emailLead(`<strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.vendorName)}</strong> has been assigned to the following open roles:`)}
        <ul style="margin:0 0 24px;padding-left:20px;color:${EMAIL_BRAND.textMuted};line-height:1.6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${list}</ul>
        ${emailButton(portalUrl, 'Open vendor portal')}
        ${emailFallbackUrl(portalUrl)}
      `,
        }),
    });
}
export async function sendStaffNotificationEmail(params) {
    return sendHtmlEmail({
        kind: params.kind,
        vendorId: params.vendorId,
        vars: {
            recipientName: params.recipientName,
            subject: params.subject,
            headline: params.headline,
            body: params.body.replace(/<[^>]+>/g, ''),
        },
        to: params.to,
        subject: params.subject,
        html: emailShell({
            headerTitle: params.headline,
            content: `
        ${emailGreeting(params.recipientName)}
        ${emailLead(escapeHtml(params.body))}
      `,
        }),
    });
}
export async function sendRequirementAgingAlertEmail(params) {
    const code = params.jobCode ? ` (${escapeHtml(params.jobCode)})` : '';
    const headline = params.threshold === 40 ? 'Requirement aging — 40 days' : 'Requirement aging — 20 days';
    return sendHtmlEmail({
        kind: 'requirementAging',
        vars: { recipientName: params.recipientName, title: params.title, jobCode: params.jobCode ?? '', daysOpen: String(params.daysOpen), threshold: String(params.threshold), requirementUrl: params.requirementUrl },
        to: params.to,
        cc: params.cc,
        bcc: params.bcc,
        subject: params.subject || `${headline}: ${params.title}`,
        html: emailShell({
            preheader: `${params.title} has been open ${params.daysOpen} days since approval and is still not closed.`,
            headerTitle: headline,
            content: `
        ${emailGreeting(params.recipientName)}
        ${emailLead(`The requirement <strong style="color:${EMAIL_BRAND.text};">${escapeHtml(params.title)}</strong>${code} has crossed <strong style="color:${EMAIL_BRAND.text};">${params.threshold} days</strong> since approval and is still not closed.`)}
        ${emailParagraph(`It has been open for <strong style="color:${EMAIL_BRAND.text};">${params.daysOpen} calendar days</strong> (ageing starts when the requirement is approved).`)}
        ${emailButton(params.requirementUrl, 'View requirement')}
        ${emailNote('Please review sourcing progress and next steps with the hiring team.')}
      `,
        }),
    });
}
export async function sendOpenRequisitionReportEmail(params) {
    return sendHtmlEmail({
        kind: 'openRequisitionReport',
        vars: { asOn: params.asOn, active: '' },
        to: params.to,
        cc: params.cc,
        bcc: params.bcc,
        subject: params.subject || `IGS | Talent Acquisition | Open Requisition status as on ${params.asOn}`,
        html: params.html,
    });
}
