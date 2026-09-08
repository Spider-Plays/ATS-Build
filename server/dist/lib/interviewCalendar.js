import { prisma } from './prisma.js';
import { env } from '../config/env.js';
import { m365Config } from '../integrations/m365/config.js';
import { buildInterviewIcs, interviewCalendarUid, interviewEndTime, } from './calendarInvite.js';
import { cancelM365InterviewEvent, createM365InterviewEvent, shouldAutoCreateTeamsMeeting, updateM365InterviewEvent, } from '../integrations/m365/calendar.js';
import { getInterviewerUsers } from './emailRecipients.js';
function organizerEmail() {
    return (process.env.M365_CALENDAR_ORGANIZER_EMAIL?.trim() ||
        m365Config.senderEmail ||
        env.emailFrom.replace(/^.*<([^>]+)>.*$/, '$1').trim() ||
        'noreply@stitch-ats.in');
}
function organizerName() {
    return m365Config.senderDisplayName || env.appName;
}
async function buildCalendarContext(ctx) {
    const [candidate, requirement, interviewers] = await Promise.all([
        prisma.candidate.findUnique({
            where: { id: ctx.candidateId },
            select: { name: true, email: true },
        }),
        prisma.requirement.findUnique({
            where: { id: ctx.requirementId },
            select: { title: true, jobCode: true },
        }),
        getInterviewerUsers(ctx.interviewerIds),
    ]);
    const candidateName = candidate?.name ?? 'Candidate';
    const stageLabel = ctx.stageName ?? ctx.type.replace(/_/g, ' ');
    const jobTitle = requirement?.title ?? 'Open role';
    const jobCode = requirement?.jobCode ? ` (${requirement.jobCode})` : '';
    const summary = `${stageLabel} interview — ${candidateName}`;
    const descriptionParts = [
        `${stageLabel} interview for ${candidateName}`,
        `Role: ${jobTitle}${jobCode}`,
        ctx.description?.trim(),
        ctx.meetingLink ? `Join: ${ctx.meetingLink}` : undefined,
        ctx.location ? `Location: ${ctx.location}` : undefined,
    ].filter(Boolean);
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
        description: descriptionParts.join('\n'),
        attendees,
        candidateName,
        jobTitle,
    };
}
export function buildInterviewIcsAttachment(ctx, meta) {
    const ics = buildInterviewIcs({
        uid: interviewCalendarUid(ctx.interviewId),
        sequence: ctx.calendarSequence,
        method: ctx.cancelled ? 'CANCEL' : 'REQUEST',
        summary: meta.summary,
        description: meta.description,
        location: ctx.location ?? undefined,
        meetingLink: ctx.meetingLink ?? undefined,
        start: ctx.scheduledAt,
        end: interviewEndTime(ctx.scheduledAt, ctx.duration),
        organizerEmail: organizerEmail(),
        organizerName: organizerName(),
        attendees: meta.attendees,
    });
    return Buffer.from(ics, 'utf8');
}
export async function syncInterviewCalendar(ctx) {
    const meta = await buildCalendarContext(ctx);
    let meetingLink = ctx.meetingLink;
    let calendarEventId = ctx.calendarEventId;
    const calendarSequence = ctx.calendarSequence;
    const eventInput = {
        subject: meta.summary,
        bodyHtml: meta.description.replace(/\n/g, '<br/>'),
        start: ctx.scheduledAt,
        end: interviewEndTime(ctx.scheduledAt, ctx.duration),
        location: ctx.location ?? undefined,
        meetingLink: meetingLink ?? undefined,
        attendees: meta.attendees,
        createTeamsMeeting: shouldAutoCreateTeamsMeeting() && !meetingLink && ctx.createOnlineMeeting !== false,
    };
    if (ctx.cancelled && calendarEventId) {
        const cancelResult = await cancelM365InterviewEvent(calendarEventId);
        if (!cancelResult.ok && cancelResult.reason === 'error') {
            console.error('[calendar]', cancelResult.message);
        }
        return { meetingLink, calendarEventId, calendarSequence };
    }
    if (!ctx.cancelled) {
        const result = calendarEventId
            ? await updateM365InterviewEvent(calendarEventId, eventInput)
            : await createM365InterviewEvent(eventInput);
        if (result.ok) {
            calendarEventId = result.eventId;
            if (result.meetingLink) {
                meetingLink = result.meetingLink;
            }
        }
        else if (result.reason === 'error') {
            console.error('[calendar]', result.message);
        }
    }
    return { meetingLink, calendarEventId, calendarSequence };
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
    };
}
