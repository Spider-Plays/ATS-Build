import { prisma } from './prisma.js';
import { logActivity } from '../services/activityLog.js';
import { env } from '../config/env.js';
import { sendAdminPasswordEmail, sendCandidateStatusEmail, sendNewCandidateNotificationEmail, sendOfferDeclinedEmail, sendOfferAcceptedEmail, sendReferralStatusEmail, sendReferralSubmittedEmail, sendStaffNotificationEmail, sendRequirementAgingAlertEmail, sendVendorAssignmentEmail, sendInterviewReminderEmail } from '../services/email.js';
import { getInterviewerUsers, getRequirementAgingAlertRecipients, getRequirementRecruiterEmails, getUserEmailsByIds, getUserEmailsByRoles, getVendorUserEmails, } from './emailRecipients.js';
import { interviewRowToCalendarContext, syncInterviewCalendar } from './interviewCalendar.js';
import { isEmailKindEnabled } from './emailToggles.js';
function fireAndForget(promise) {
    promise.catch((err) => console.error('[email]', err instanceof Error ? err.message : err));
}
async function sendToMany(recipients, send) {
    await Promise.allSettled(recipients.map((r) => send(r)));
}
/** Notice only: the new password is shared by the admin in person, never by email. */
export function notifyAdminPasswordReset(user, setByAdmin = true) {
    fireAndForget(sendAdminPasswordEmail({ to: user.email, name: user.name, setByAdmin }));
}
export async function prepareInterviewCalendar(row, options) {
    const ctx = await interviewRowToCalendarContext(row, {
        createOnlineMeeting: options?.createOnlineMeeting,
    });
    const synced = await syncInterviewCalendar(ctx);
    const needsUpdate = synced.meetingLink !== row.meetingLink ||
        synced.calendarEventId !== row.calendarEventId ||
        synced.calendarSequence !== row.calendarSequence;
    if (needsUpdate) {
        await prisma.interview.update({
            where: { id: row.id },
            data: {
                meetingLink: synced.meetingLink,
                calendarEventId: synced.calendarEventId,
                calendarSequence: synced.calendarSequence,
            },
        });
    }
    return {
        ...row,
        meetingLink: synced.meetingLink,
        calendarEventId: synced.calendarEventId,
        calendarSequence: synced.calendarSequence,
    };
}
/** Outlook sends the interview. Stitch does not send a second interview email. */
export function notifyInterviewScheduled(_interview) { }
export function notifyInterviewUpdated(interview, options) {
    void interview;
    void options;
}
export function notifyInterviewCancelled(interview) {
    fireAndForget((async () => {
        const stage = interview.planStageId
            ? await prisma.interviewPlanStage.findUnique({ where: { id: interview.planStageId } })
            : null;
        const ctx = await interviewRowToCalendarContext({ ...interview, planStageId: interview.planStageId }, { cancelled: true, stageName: stage?.name });
        await syncInterviewCalendar(ctx);
    })());
}
export function notifyOfferStatusChange(offer, status) {
    if (status !== 'ACCEPTED' && status !== 'DECLINED')
        return;
    fireAndForget((async () => {
        const [candidate, requirement] = await Promise.all([
            prisma.candidate.findUnique({ where: { id: offer.candidateId } }),
            prisma.requirement.findUnique({
                where: { id: offer.requirementId },
                select: { title: true, jobCode: true },
            }),
        ]);
        if (!candidate)
            return;
        const jobTitle = requirement?.title ?? candidate.jobTitle ?? 'the role';
        const recruiters = await getRequirementRecruiterEmails(offer.requirementId);
        const creator = await getUserEmailsByIds([offer.createdBy]);
        const recipients = [...recruiters];
        for (const c of creator) {
            if (!recipients.some((r) => r.email === c.email)) {
                recipients.push({ email: c.email, name: c.name });
            }
        }
        const payload = {
            candidateName: candidate.name,
            jobTitle,
            baseSalary: offer.baseSalary,
        };
        await sendToMany(recipients, (u) => status === 'ACCEPTED'
            ? sendOfferAcceptedEmail({ to: u.email, recipientName: u.name, ...payload })
            : sendOfferDeclinedEmail({ to: u.email, recipientName: u.name, ...payload }));
    })());
}
async function offerNotificationRecipients(offer) {
    const creator = await getUserEmailsByIds([offer.createdBy]);
    const recruiters = await getRequirementRecruiterEmails(offer.requirementId);
    const recipients = [...recruiters];
    for (const c of creator) {
        if (!recipients.some((r) => r.email === c.email)) {
            recipients.push({ email: c.email, name: c.name });
        }
    }
    return recipients;
}
export function notifyOfferSubmittedForApproval(offer) {
    fireAndForget((async () => {
        const [candidate, approvers] = await Promise.all([
            prisma.candidate.findUnique({ where: { id: offer.candidateId } }),
            getUserEmailsByRoles(['HR_HEAD', 'ADMIN']),
        ]);
        if (!candidate)
            return;
        await sendToMany(approvers, (u) => sendStaffNotificationEmail({
            to: u.email,
            recipientName: u.name,
            kind: 'offerPendingHr',
            subject: `Offer pending HR approval — ${candidate.name}`,
            headline: 'Offer pending approval',
            body: `An offer for <strong>${candidate.name}</strong> is awaiting HR approval. <a href="${env.clientOrigin}/offers/${offer.id}">Review offer</a>`,
        }));
    })());
}
export function notifyOfferPendingExecApproval(offer) {
    fireAndForget((async () => {
        const [candidate, approvers] = await Promise.all([
            prisma.candidate.findUnique({ where: { id: offer.candidateId } }),
            getUserEmailsByRoles(['ADMIN']),
        ]);
        if (!candidate)
            return;
        await sendToMany(approvers, (u) => sendStaffNotificationEmail({
            to: u.email,
            recipientName: u.name,
            kind: 'offerPendingExecutive',
            subject: `Offer pending executive approval — ${candidate.name}`,
            headline: 'Executive approval required',
            body: `High-compensation offer for <strong>${candidate.name}</strong> requires executive approval. <a href="${env.clientOrigin}/offers/${offer.id}">Review offer</a>`,
        }));
    })());
}
export function notifyOfferApproved(offer) {
    fireAndForget((async () => {
        const candidate = await prisma.candidate.findUnique({ where: { id: offer.candidateId } });
        if (!candidate)
            return;
        const recipients = await offerNotificationRecipients(offer);
        await sendToMany(recipients, (u) => sendStaffNotificationEmail({
            to: u.email,
            recipientName: u.name,
            kind: 'offerApprovedStaff',
            subject: `Offer approved — ${candidate.name}`,
            headline: 'Offer approved',
            body: `The offer for <strong>${candidate.name}</strong> has been approved and is ready to send. <a href="${env.clientOrigin}/offers/${offer.id}">View offer</a>`,
        }));
    })());
}
export function notifyOfferRejected(offer) {
    fireAndForget((async () => {
        const candidate = await prisma.candidate.findUnique({ where: { id: offer.candidateId } });
        if (!candidate)
            return;
        const recipients = await offerNotificationRecipients(offer);
        const reason = offer.rejectionReason ? ` Reason: ${offer.rejectionReason}.` : '';
        await sendToMany(recipients, (u) => sendStaffNotificationEmail({
            to: u.email,
            recipientName: u.name,
            kind: 'offerRejectedStaff',
            subject: `Offer rejected — ${candidate.name}`,
            headline: 'Offer rejected',
            body: `The offer for <strong>${candidate.name}</strong> was rejected and returned to draft.${reason} <a href="${env.clientOrigin}/offers/${offer.id}">View offer</a>`,
        }));
    })());
}
export function notifyCandidateStatusChange(candidate, previousStatus) {
    if (candidate.status === previousStatus)
        return;
    const notifyCandidateStatuses = new Set([
        'TO_BE_SCREENED',
        'SCREEN_SELECT',
        'SCREEN_REJECT',
        'L1_INTERVIEW',
        'L1_INTERVIEW_REJECT',
        'MANAGERIAL_INTERVIEW',
        'MANAGERIAL_INTERVIEW_REJECT',
        'CLIENT_INTERVIEW',
        'CLIENT_INTERVIEW_REJECT',
        'HR_INTERVIEW',
        'HR_INTERVIEW_SELECT',
        'HR_INTERVIEW_REJECT',
        'TO_BE_OFFERED',
        'OFFERED',
        'OFFER_ACCEPTED',
        'POSITION_ABORT',
        'OFFER_DECLINED',
        'CANDIDATE_ABORT',
        'JOINED',
        'BANK',
        'ON_HOLD',
    ]);
    // JOINED referrals get the richer referralJoined workflow mail instead.
    const notifyReferrerStatuses = new Set([
        'SCREEN_REJECT',
        'L1_INTERVIEW_REJECT',
        'MANAGERIAL_INTERVIEW_REJECT',
        'CLIENT_INTERVIEW_REJECT',
        'HR_INTERVIEW_REJECT',
        'POSITION_ABORT',
        'OFFER_DECLINED',
        'CANDIDATE_ABORT',
    ]);
    const rejectOrAbortStatuses = new Set([
        'SCREEN_REJECT',
        'L1_INTERVIEW_REJECT',
        'MANAGERIAL_INTERVIEW_REJECT',
        'CLIENT_INTERVIEW_REJECT',
        'HR_INTERVIEW_REJECT',
        'POSITION_ABORT',
        'OFFER_DECLINED',
        'CANDIDATE_ABORT',
    ]);
    fireAndForget((async () => {
        if (candidate.referredByUserId && candidate.status === 'JOINED') {
            const { onReferralJoined } = await import('./referralWorkflow.js');
            await onReferralJoined(candidate.id);
        }
        const requirement = candidate.requirementId
            ? await prisma.requirement.findUnique({
                where: { id: candidate.requirementId },
                select: { title: true },
            })
            : null;
        const jobTitle = requirement?.title ?? candidate.jobTitle ?? 'your application';
        if (candidate.email && notifyCandidateStatuses.has(candidate.status)) {
            await sendCandidateStatusEmail({
                to: candidate.email,
                candidateName: candidate.name,
                status: candidate.status,
                jobTitle,
            });
        }
        if (candidate.referredByUserId && notifyReferrerStatuses.has(candidate.status)) {
            const referrer = await prisma.user.findUnique({
                where: { id: candidate.referredByUserId },
                select: { email: true, name: true },
            });
            if (referrer?.email) {
                await sendReferralStatusEmail({
                    to: referrer.email,
                    referrerName: referrer.name,
                    candidateName: candidate.name,
                    jobTitle,
                    status: candidate.status,
                });
            }
        }
        if (rejectOrAbortStatuses.has(candidate.status)) {
            const recruiters = await getRequirementRecruiterEmails(candidate.requirementId);
            await sendToMany(recruiters, (u) => sendStaffNotificationEmail({
                to: u.email,
                recipientName: u.name,
                kind: 'candidateStatusStaff',
                subject: `Candidate status updated — ${candidate.name}`,
                headline: 'Candidate status updated',
                body: `<strong>${candidate.name}</strong> was marked as <strong>${candidate.status.replace(/_/g, ' ')}</strong> for <strong>${jobTitle}</strong>.`,
            }));
        }
    })());
}
export function notifyNewCandidate(candidate, context) {
    fireAndForget((async () => {
        const recruiters = await getRequirementRecruiterEmails(candidate.requirementId);
        if (recruiters.length === 0)
            return;
        const requirement = candidate.requirementId
            ? await prisma.requirement.findUnique({
                where: { id: candidate.requirementId },
                select: { title: true, jobCode: true },
            })
            : null;
        await sendToMany(recruiters, (u) => sendNewCandidateNotificationEmail({
            to: u.email,
            recipientName: u.name,
            candidateName: candidate.name,
            candidateEmail: candidate.email,
            jobTitle: requirement?.title ?? candidate.jobTitle ?? 'Open role',
            jobCode: requirement?.jobCode ?? undefined,
            source: candidate.source,
            submittedBy: context.submittedBy,
            vendorName: context.vendorName,
            referrerName: context.referrerName,
        }));
    })());
}
export function notifyReferralSubmitted(candidate, referrer, requirement) {
    fireAndForget(sendReferralSubmittedEmail({
        to: referrer.email,
        referrerName: referrer.name,
        candidateName: candidate.name,
        jobTitle: requirement.title,
        jobCode: requirement.jobCode ?? undefined,
    }));
}
export function notifyVendorAssignment(vendor, requirements) {
    if (requirements.length === 0)
        return;
    fireAndForget((async () => {
        const vendorUsers = await getVendorUserEmails(vendor.id);
        await sendToMany(vendorUsers, (u) => sendVendorAssignmentEmail({
            to: u.email,
            recipientName: u.name,
            vendorName: vendor.name,
            vendorId: vendor.id,
            requirements,
        }));
    })());
}
export async function runInterviewReminders() {
    const now = Date.now();
    const windowMs = 30 * 60 * 1000;
    const targets = [
        { hours: 24, action: 'INTERVIEW_REMINDER_24H' },
        { hours: 1, action: 'INTERVIEW_REMINDER_1H' },
    ];
    for (const target of targets) {
        const center = now + target.hours * 60 * 60 * 1000;
        const from = new Date(center - windowMs);
        const to = new Date(center + windowMs);
        const interviews = await prisma.interview.findMany({
            where: {
                status: 'SCHEDULED',
                scheduledAt: { gte: from, lte: to },
            },
        });
        for (const interview of interviews) {
            const alreadySent = await prisma.activityLog.findFirst({
                where: {
                    entityType: 'INTERVIEW',
                    entityId: interview.id,
                    action: target.action,
                },
            });
            if (alreadySent)
                continue;
            if (!(await isEmailKindEnabled('interviewReminder')))
                continue;
            const candidate = await prisma.candidate.findUnique({
                where: { id: interview.candidateId },
                select: { name: true, email: true },
            });
            const interviewers = await getInterviewerUsers(interview.interviewerIds);
            const when = new Intl.DateTimeFormat('en-IN', {
                timeZone: 'Asia/Kolkata',
                dateStyle: 'medium',
                timeStyle: 'short',
            }).format(interview.scheduledAt);
            const recipients = [
                ...(candidate?.email ? [{ email: candidate.email, name: candidate.name }] : []),
                ...interviewers,
            ];
            await sendToMany(recipients, (person) => sendInterviewReminderEmail({
                to: person.email,
                recipientName: person.name,
                type: interview.type,
                scheduledAt: when,
                meetingLink: interview.meetingLink ?? undefined,
                location: interview.location ?? undefined,
                hoursUntil: target.hours,
                candidateName: candidate?.name,
            }));
            await logActivity({
                entityType: 'INTERVIEW',
                entityId: interview.id,
                action: target.action,
                performedBy: 'system',
                performerName: 'System',
                details: { scheduledAt: interview.scheduledAt.toISOString(), hoursUntil: target.hours },
            });
        }
    }
}
export function notifyLinkedRequirementCreated(businessReq) {
    fireAndForget((async () => {
        const { getLinkedRequirementCreatedNotificationRecipients } = await import('./emailRecipients.js');
        const recipients = await getLinkedRequirementCreatedNotificationRecipients(businessReq);
        const clientLabel = businessReq.client ? ` · ${businessReq.client}` : '';
        await sendToMany(recipients, (u) => sendStaffNotificationEmail({
            to: u.email,
            recipientName: u.name,
            kind: 'requirementAfterSow',
            subject: `New requirement after SOW: ${businessReq.title}`,
            headline: 'Requirement created',
            body: `<strong>${businessReq.title}</strong>${clientLabel} was added after SOW on the client card. <a href="${env.clientOrigin}/business-requirements/${businessReq.id}">View requirement</a> · <a href="${env.clientOrigin}/business-requirements/client/${businessReq.clientDealId}">View client card</a>`,
        }));
    })());
}
export function notifyBusinessRequirementStageChanged(businessReq) {
    fireAndForget((async () => {
        const { getBusinessRequirementStageNotificationRecipients } = await import('./emailRecipients.js');
        const { businessStageLabel } = await import('./businessStages.js');
        const recipients = await getBusinessRequirementStageNotificationRecipients(businessReq);
        const clientLabel = businessReq.client ? ` · ${businessReq.client}` : '';
        const stageLabel = businessStageLabel(businessReq.stage);
        const isSow = businessReq.stage === 'SOW_SIGNED';
        const note = businessReq.description
            ? `<p style="margin:12px 0 0;padding:12px;background:#f4f4f5;border-radius:8px;font-size:14px;"><strong>Note:</strong> ${businessReq.description
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/\n/g, '<br/>')}</p>`
            : '';
        await sendToMany(recipients, (u) => sendStaffNotificationEmail({
            to: u.email,
            recipientName: u.name,
            kind: 'businessRequirementStage',
            subject: `Business requirement — ${stageLabel}: ${businessReq.title}`,
            headline: isSow ? 'SOW Signed' : 'Deal stage updated',
            body: `<strong>${businessReq.title}</strong>${clientLabel} is now at <strong>${stageLabel}</strong>.${note} <a href="${env.clientOrigin}/business-requirements/${businessReq.id}">View requirement</a>`,
        }));
    })());
}
export function startInterviewReminderJob() {
    const intervalMs = 15 * 60 * 1000;
    fireAndForget(runInterviewReminders());
    setInterval(() => fireAndForget(runInterviewReminders()), intervalMs);
}
export async function runRequirementAgingAlerts() {
    const { AGING_ALERT_20_ACTION, AGING_ALERT_40_ACTION, REQUIREMENT_AGING_ORANGE_DAYS, REQUIREMENT_AGING_RED_DAYS, computeRequirementAgingDays, isOpenForAgingAlerts, } = await import('./requirementAging.js');
    const now = new Date();
    const openReqs = await prisma.requirement.findMany({
        where: {
            status: { in: ['LIVE', 'ON_HOLD', 'APPROVED'] },
            liveAt: { not: null },
            closedAt: null,
        },
        select: {
            id: true,
            title: true,
            jobCode: true,
            status: true,
            liveAt: true,
            raisedOn: true,
            closedAt: true,
            recruiters: true,
            hiringManager: true,
            location: true,
            locationCity: true,
            hiringStage: true,
        },
    });
    const thresholds = [
        { days: REQUIREMENT_AGING_ORANGE_DAYS, action: AGING_ALERT_20_ACTION },
        { days: REQUIREMENT_AGING_RED_DAYS, action: AGING_ALERT_40_ACTION },
    ];
    for (const req of openReqs) {
        if (!isOpenForAgingAlerts(req.status) || !req.liveAt)
            continue;
        const agingDays = computeRequirementAgingDays(req, now);
        if (agingDays == null)
            continue;
        for (const target of thresholds) {
            if (agingDays < target.days)
                continue;
            const alreadySent = await prisma.activityLog.findFirst({
                where: {
                    entityType: 'REQUIREMENT',
                    entityId: req.id,
                    action: target.action,
                },
            });
            if (alreadySent)
                continue;
            const recipients = await getRequirementAgingAlertRecipients(req);
            const { fillReportSubject, getReportMailControls } = await import('./reportMail.js');
            const controls = await getReportMailControls();
            const requirementUrl = `${env.clientOrigin.replace(/\/$/, '')}/requirements/${req.id}`;
            const headline = target.days === 40 ? 'Requirement aging — 40 days' : 'Requirement aging — 20 days';
            const subject = fillReportSubject(controls.aging.subject, {
                headline,
                jobTitle: req.title,
                reqId: req.jobCode ?? '',
                daysOpen: String(agingDays),
            });
            const known = new Set(recipients.map((u) => u.email.toLowerCase()));
            const extraPeople = controls.aging.extraTo
                .filter((email) => !known.has(email))
                .map((email) => ({ email, name: email }));
            await sendToMany([...recipients, ...extraPeople], (u) => sendRequirementAgingAlertEmail({
                to: u.email,
                cc: controls.aging.cc,
                bcc: controls.aging.bcc,
                recipientName: u.name,
                title: req.title,
                jobCode: req.jobCode,
                location: req.locationCity || req.location,
                hiringManager: req.hiringManager,
                pipeline: req.hiringStage,
                daysOpen: agingDays,
                threshold: target.days,
                requirementUrl,
                subject,
            }));
            await logActivity({
                entityType: 'REQUIREMENT',
                entityId: req.id,
                action: target.action,
                performedBy: 'system',
                performerName: 'System',
                details: {
                    title: req.title,
                    jobCode: req.jobCode,
                    daysOpen: agingDays,
                    threshold: target.days,
                },
            });
        }
    }
}
export function startRequirementAgingAlertJob() {
    // Daily cadence is enough for day thresholds; hourly covers free-tier sleep wakeups.
    const intervalMs = 60 * 60 * 1000;
    fireAndForget(runRequirementAgingAlerts());
    setInterval(() => fireAndForget(runRequirementAgingAlerts()), intervalMs);
}
const OPEN_REQ_REPORT_SETTING = 'openRequisitionReportSentOn';
function istCalendar(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    })
        .formatToParts(now)
        .map((part) => [part.type, part.value]));
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
    };
}
/** Milliseconds until the next 11:00:00 Asia/Kolkata. */
function msUntilNextOpenRequisitionReport(now = new Date()) {
    const { hour, minute, second } = istCalendar(now);
    const pastEleven = hour > 11 || (hour === 11 && (minute > 0 || second > 0));
    const hoursAhead = (pastEleven ? 24 : 0) + (11 - hour);
    const waitMs = ((hoursAhead * 60 - minute) * 60 - second) * 1000;
    return waitMs < 1000 ? 24 * 60 * 60 * 1000 : waitMs;
}
/** Daily open-requisition status mail, targeted for 11:00 Asia/Kolkata. Active requisitions only. */
export async function runOpenRequisitionReport(now = new Date(), options) {
    const { isEmailConfigured, sendOpenRequisitionReportEmail } = await import('../services/email.js');
    const { buildOpenRequisitionReport, renderOpenRequisitionReportHtml } = await import('./openRequisitionReport.js');
    const { getOpenRequisitionReportRecipients } = await import('./openRequisitionReportRecipients.js');
    if (!isEmailConfigured())
        return { sent: false, reason: 'email_not_configured' };
    const recipients = await getOpenRequisitionReportRecipients();
    if (recipients.to.length === 0)
        return { sent: false, reason: 'no_recipients' };
    const today = istCalendar(now);
    if (!options?.force && today.hour < 11)
        return { sent: false, reason: 'before_11_ist' };
    const marker = await prisma.appSetting.findUnique({ where: { key: OPEN_REQ_REPORT_SETTING } });
    if (!options?.force && marker?.value === today.date)
        return { sent: false, reason: 'already_sent' };
    const asOn = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(now);
    const report = await buildOpenRequisitionReport(now);
    const html = renderOpenRequisitionReportHtml(report);
    const { fillReportSubject, getReportMailControls } = await import('./reportMail.js');
    const controls = await getReportMailControls();
    const result = await sendOpenRequisitionReportEmail({
        to: recipients.to,
        cc: recipients.cc,
        bcc: recipients.bcc,
        html,
        asOn,
        subject: fillReportSubject(controls.openRequisitionSubject, { asOn, active: String(report.active) }),
    });
    if (!result.sent)
        return { sent: false, reason: result.reason === 'error' ? result.message : result.reason };
    await prisma.appSetting.upsert({
        where: { key: OPEN_REQ_REPORT_SETTING },
        create: { key: OPEN_REQ_REPORT_SETTING, value: today.date, updatedBy: 'system' },
        update: { value: today.date, updatedBy: 'system' },
    });
    return { sent: true, active: report.active };
}
export function startOpenRequisitionReportJob() {
    const scheduleNext = () => {
        setTimeout(() => {
            fireAndForget(runOpenRequisitionReport());
            scheduleNext();
        }, msUntilNextOpenRequisitionReport());
    };
    fireAndForget(runOpenRequisitionReport());
    scheduleNext();
}
