import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { interviewEndTime } from './calendarInvite.js';
import { calendarOrganizerEmail, cancelM365InterviewEvent, createM365InterviewEvent, createTeamsOnlineMeeting, deletePrivateBusyHold, shouldAutoCreateTeamsMeeting, updateM365InterviewEvent, } from '../integrations/m365/calendar.js';
import { getInterviewerUsers } from './emailRecipients.js';
/**
 * New invites are organized from the scheduler's own Outlook calendar when their address is in
 * the tenant (same domain as the shared organizer, or M365_CALENDAR_ORGANIZER_DOMAINS).
 * M365_CALENDAR_USE_SCHEDULER_MAILBOX=false keeps everything on the shared mailbox.
 */
async function schedulerOrganizerEmail(interviewId) {
    const flag = process.env.M365_CALENDAR_USE_SCHEDULER_MAILBOX?.trim().toLowerCase();
    if (flag === 'false' || flag === '0')
        return undefined;
    const interview = await prisma.interview.findUnique({ where: { id: interviewId }, select: { scheduledBy: true } });
    if (!interview?.scheduledBy)
        return undefined;
    const user = await prisma.user.findUnique({ where: { id: interview.scheduledBy }, select: { email: true, status: true } });
    const email = user?.status === 'ACTIVE' ? user.email?.trim().toLowerCase() : undefined;
    if (!email)
        return undefined;
    const domains = (process.env.M365_CALENDAR_ORGANIZER_DOMAINS || calendarOrganizerEmail().split('@')[1] || '')
        .split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean);
    return domains.includes(email.split('@')[1] ?? '') ? email : undefined;
}
function interviewInviteWhen(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).formatToParts(date);
    const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
    const day = Number(pick('day'));
    const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th');
    const minute = pick('minute');
    const clock = `${pick('hour')}:${minute} ${pick('dayPeriod').toUpperCase()}`;
    return {
        date: `${day}${suffix} ${pick('month')} ${pick('year')}, ${pick('weekday')}`,
        time: clock,
    };
}
async function recruiterNames(requirementId) {
    const requirement = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: { recruiters: true },
    });
    let ids = [];
    try {
        const parsed = JSON.parse(requirement?.recruiters || '[]');
        ids = Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    }
    catch {
        ids = [];
    }
    if (ids.length === 0)
        return 'Talent Acquisition';
    const users = await prisma.user.findMany({
        where: { id: { in: ids }, status: 'ACTIVE' },
        select: { name: true },
    });
    const names = users.map((user) => user.name).filter(Boolean);
    return names.length ? names.join(', ') : 'Talent Acquisition';
}
function esc(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** Calendar event bodies cannot carry inline images, so the Stitch header is text-only. */
function inviteShell(title, inner) {
    return `<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<tr><td bgcolor="#1e3a8a" style="background-color:#1e3a8a;padding:16px 24px;border-radius:8px;color:#ffffff;font-size:18px;font-weight:700;">${esc(title)}</td></tr>
<tr><td bgcolor="#ffffff" style="padding:24px 4px 8px;color:#1f2937;font-size:14px;line-height:22px;">${inner}</td></tr>
</table>`;
}
async function buildCalendarContext(ctx) {
    const [candidate, requirement, interviewers] = await Promise.all([
        prisma.candidate.findUnique({
            where: { id: ctx.candidateId },
            select: { name: true, email: true },
        }),
        prisma.requirement.findUnique({
            where: { id: ctx.requirementId },
            select: { title: true, jobCode: true, client: true, projectName: true },
        }),
        getInterviewerUsers(ctx.interviewerIds),
    ]);
    const candidateName = candidate?.name ?? 'Candidate';
    const stageLabel = ctx.stageName ?? ctx.type.replace(/_/g, ' ');
    const jobTitle = requirement?.title ?? 'Open role';
    const summary = `Interview: ${candidateName} - ${jobTitle} - ${stageLabel}`;
    const when = interviewInviteWhen(ctx.scheduledAt);
    const recruiterName = await recruiterNames(ctx.requirementId);
    const project = requirement?.projectName?.trim() || requirement?.client?.trim() || jobTitle;
    const descriptionParts = [
        `Hello ${candidateName},`,
        `Greetings from IGS! In continuation to your discussion with us regarding the job opportunity, we are keen to invite you to a ${stageLabel}.`,
        `Position: ${jobTitle}`,
        `Date: ${when.date}`,
        `Time: ${when.time} IST`,
        'Mode: MS Teams (Video Conferencing)',
        'Please accept the meeting invite to confirm your availability.',
        'Regards, Talent Acquisition, IGS Global',
        `For any changes, please reach out to ${recruiterName}.`,
    ];
    const attendees = [];
    if (candidate?.email) {
        attendees.push({ email: candidate.email, name: candidate.name });
    }
    for (const interviewer of interviewers) {
        if (!attendees.some((a) => a.email.toLowerCase() === interviewer.email.toLowerCase())) {
            attendees.push(interviewer);
        }
    }
    return {
        summary,
        description: descriptionParts.join('\n\n'),
        attendees,
        stageLabel,
        dateLabel: when.date,
        timeLabel: when.time,
        recruiterName,
        project,
        candidateName,
        jobTitle,
    };
}
export async function syncInterviewCalendar(ctx) {
    const meta = await buildCalendarContext(ctx);
    let meetingLink = ctx.meetingLink;
    let calendarEventId = ctx.calendarEventId;
    const calendarSequence = ctx.calendarSequence;
    const end = interviewEndTime(ctx.scheduledAt, ctx.duration);
    const holds = await readHolds(ctx.interviewId);
    if (ctx.cancelled) {
        const { isEmailKindEnabled } = await import('./emailToggles.js');
        const sendCancel = await isEmailKindEnabled('interviewCancelled');
        if (sendCancel && calendarEventId && !holds.some((hold) => hold.eventId === calendarEventId)) {
            const cancelResult = await cancelM365InterviewEvent(calendarEventId);
            if (!cancelResult.ok && cancelResult.reason === 'error')
                console.error('[calendar]', cancelResult.message);
        }
        for (const hold of holds) {
            if (hold.mailbox === 'organizer') {
                if (sendCancel) {
                    const cancelResult = await cancelM365InterviewEvent(hold.eventId, holdOrganizer(hold));
                    if (!cancelResult.ok && cancelResult.reason === 'error')
                        console.error('[calendar]', cancelResult.message);
                }
            }
            else
                await deletePrivateBusyHold(hold.email, hold.eventId);
        }
        await writeHolds(ctx.interviewId, []);
        return { meetingLink, calendarEventId, calendarSequence };
    }
    if (!meetingLink && shouldAutoCreateTeamsMeeting() && ctx.createOnlineMeeting !== false) {
        const meeting = await createTeamsOnlineMeeting({ subject: meta.summary, start: ctx.scheduledAt, end, organizer: ctx.organizerEmail });
        if (meeting.ok)
            meetingLink = meeting.joinUrl;
        else
            console.error('[calendar]', meeting.message);
    }
    const sharedOrganizer = calendarOrganizerEmail();
    const known = new Set(holds.map((hold) => hold.eventId));
    if (calendarEventId && !known.has(calendarEventId)) {
        const cancelResult = await cancelM365InterviewEvent(calendarEventId);
        if (!cancelResult.ok && cancelResult.reason === 'error')
            console.error('[calendar]', cancelResult.message);
        calendarEventId = null;
    }
    const portalUrl = `${env.clientOrigin.replace(/\/$/, '')}/interviews/${ctx.interviewId}`;
    const people = [];
    const candidateRow = await prisma.candidate.findUnique({ where: { id: ctx.candidateId }, select: { email: true, name: true } });
    if (candidateRow?.email)
        people.push({ email: candidateRow.email, name: candidateRow.name, role: 'candidate' });
    for (const person of meta.attendees) {
        if (person.email.toLowerCase() === candidateRow?.email?.toLowerCase())
            continue;
        people.push({ email: person.email, name: person.name, role: 'panel' });
    }
    const { getWorkflowTemplates, renderWorkflowContent, fillWorkflowText } = await import('./workflowMail.js');
    const { isEmailKindEnabled } = await import('./emailToggles.js');
    const templates = await getWorkflowTemplates();
    const [candidateMailOn, panelMailOn, updateMailOn] = await Promise.all([
        isEmailKindEnabled('interviewScheduled'),
        isEmailKindEnabled('interviewerAssigned'),
        isEmailKindEnabled('interviewUpdated'),
    ]);
    const sharedValues = {
        candidateName: meta.candidateName,
        jobTitle: meta.jobTitle,
        interviewRound: meta.stageLabel,
        interviewDate: meta.dateLabel,
        interviewTime: meta.timeLabel,
        project: meta.project,
        recruiterName: meta.recruiterName,
        meetingLink: meetingLink ?? '',
        portalUrl,
    };
    const nextHolds = [];
    for (const person of people) {
        const template = person.role === 'candidate' ? templates.interviewScheduledCandidate : templates.interviewScheduledPanel;
        if (!template.enabled)
            continue;
        const existingHold = holds.find((hold) => hold.email === person.email.toLowerCase() && hold.mailbox === 'organizer');
        if (existingHold) {
            if (!updateMailOn) {
                nextHolds.push(existingHold);
                continue;
            }
        }
        else if (person.role === 'candidate' ? !candidateMailOn : !panelMailOn) {
            continue;
        }
        const buildInput = () => {
            const values = { ...sharedValues, panelName: person.name, candidateName: person.role === 'candidate' ? person.name : meta.candidateName };
            return {
                subject: fillWorkflowText(template.subject, values) || meta.summary,
                bodyHtml: inviteShell(person.role === 'candidate' ? 'IGS Global | Interview Invitation' : 'IGS Global | Interview Panel', renderWorkflowContent(template.body, values)),
                start: ctx.scheduledAt,
                end,
                location: 'Microsoft Teams Meeting',
                attendees: [{ email: person.email, name: person.name }],
            };
        };
        const eventInput = buildInput();
        const key = person.email.toLowerCase();
        const existing = existingHold;
        // Standalone onlineMeetings needs a Teams application access policy; when that failed, let the
        // first event host the Teams meeting and reuse its join link for everyone else.
        const hostTeams = !meetingLink && ctx.createOnlineMeeting !== false && shouldAutoCreateTeamsMeeting();
        // Existing invites stay with the mailbox that sent them; new ones go out from the scheduler's
        // calendar, falling back to the shared mailbox when theirs is not reachable.
        let organizer = existing ? holdOrganizer(existing) : ctx.organizerEmail || sharedOrganizer;
        let result = existing
            ? await updateM365InterviewEvent(existing.eventId, { ...eventInput, createTeamsMeeting: hostTeams }, organizer)
            : await createM365InterviewEvent({ ...eventInput, createTeamsMeeting: hostTeams }, organizer);
        if (!result.ok && !existing && organizer !== sharedOrganizer) {
            console.error('[calendar] scheduler mailbox failed, using shared organizer:', result.message);
            organizer = sharedOrganizer;
            result = await createM365InterviewEvent({ ...eventInput, createTeamsMeeting: hostTeams }, organizer);
        }
        if (!result.ok) {
            if (result.reason === 'error')
                console.error('[calendar]', result.message);
            if (existing)
                nextHolds.push(existing);
            continue;
        }
        if (hostTeams && result.meetingLink) {
            meetingLink = result.meetingLink;
            sharedValues.meetingLink = meetingLink;
            const patched = await updateM365InterviewEvent(result.eventId, buildInput(), organizer);
            if (!patched.ok && patched.reason === 'error')
                console.error('[calendar]', patched.message);
        }
        nextHolds.push({ email: key, eventId: result.eventId, mailbox: 'organizer', organizer });
        if (person.role === 'candidate')
            calendarEventId = result.eventId;
    }
    const kept = new Set(nextHolds.map((hold) => hold.eventId));
    for (const hold of holds) {
        if (kept.has(hold.eventId))
            continue;
        if (hold.mailbox === 'organizer')
            await cancelM365InterviewEvent(hold.eventId, holdOrganizer(hold));
        else
            await deletePrivateBusyHold(hold.email, hold.eventId);
    }
    await writeHolds(ctx.interviewId, nextHolds);
    if (!calendarEventId && nextHolds[0])
        calendarEventId = nextHolds[0].eventId;
    return { meetingLink, calendarEventId, calendarSequence };
}
function holdOrganizer(hold) {
    return hold.organizer || calendarOrganizerEmail();
}
function holdsKey(interviewId) {
    return `interview_private_holds:${interviewId}`;
}
async function readHolds(interviewId) {
    const row = await prisma.appSetting.findUnique({ where: { key: holdsKey(interviewId) } });
    if (!row)
        return [];
    try {
        const parsed = JSON.parse(row.value);
        return Array.isArray(parsed)
            ? parsed
                .filter((hold) => hold && hold.email && hold.eventId)
                .map((hold) => ({
                email: hold.email,
                eventId: hold.eventId,
                mailbox: hold.mailbox || hold.email,
                organizer: hold.organizer,
            }))
            : [];
    }
    catch {
        return [];
    }
}
async function writeHolds(interviewId, holds) {
    await prisma.appSetting.upsert({
        where: { key: holdsKey(interviewId) },
        create: { key: holdsKey(interviewId), value: JSON.stringify(holds), updatedBy: 'system' },
        update: { value: JSON.stringify(holds), updatedBy: 'system' },
    });
}
export async function releasePrivateBusyHold(interviewId, email) {
    const key = email.trim().toLowerCase();
    const existing = await readHolds(interviewId);
    const hold = existing.find((item) => item.email === key);
    if (!hold)
        return;
    if (hold.mailbox === 'organizer')
        await cancelM365InterviewEvent(hold.eventId, holdOrganizer(hold));
    else
        await deletePrivateBusyHold(hold.email, hold.eventId);
    await writeHolds(interviewId, existing.filter((item) => item.email !== key));
}
export async function interviewRowToCalendarContext(row, options) {
    let stageName = options?.stageName;
    if (!stageName && row.planStageId) {
        const stage = await prisma.interviewPlanStage.findUnique({
            where: { id: row.planStageId },
            select: { name: true },
        });
        stageName = stage?.name;
    }
    return {
        interviewId: row.id,
        candidateId: row.candidateId,
        requirementId: row.requirementId,
        type: row.type,
        scheduledAt: row.scheduledAt,
        duration: row.duration,
        meetingLink: row.meetingLink,
        location: row.location,
        description: row.description,
        interviewerIds: row.interviewerIds,
        calendarEventId: row.calendarEventId,
        calendarSequence: row.calendarSequence,
        stageName,
        cancelled: options?.cancelled,
        createOnlineMeeting: options?.createOnlineMeeting,
        organizerEmail: await schedulerOrganizerEmail(row.id),
    };
}
