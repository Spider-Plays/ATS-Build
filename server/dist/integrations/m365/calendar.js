import { env } from '../../config/env.js';
import { m365Config } from './config.js';
import { getGraphAccessToken, isM365EmailConfigured } from './client.js';
function calendarOrganizerEmail() {
    return (process.env.M365_CALENDAR_ORGANIZER_EMAIL?.trim() ||
        m365Config.senderEmail);
}
export function isM365CalendarEnabled() {
    if (!isM365EmailConfigured())
        return false;
    const flag = process.env.M365_CALENDAR_ENABLED?.trim().toLowerCase();
    if (flag === 'false' || flag === '0')
        return false;
    return true;
}
export function shouldAutoCreateTeamsMeeting() {
    const flag = process.env.M365_AUTO_TEAMS_MEETING?.trim().toLowerCase();
    if (flag === 'false' || flag === '0')
        return false;
    return true;
}
function calendarTimeZone() {
    return process.env.M365_CALENDAR_TIMEZONE?.trim() || 'UTC';
}
function toGraphDateTime(date) {
    const tz = calendarTimeZone();
    if (tz === 'UTC') {
        return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).formatToParts(date);
        const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
        return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
    }
    catch {
        return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
}
async function graphRequest(path, init) {
    const token = await getGraphAccessToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
        },
    });
    const text = await response.text();
    if (!response.ok) {
        return { ok: false, status: response.status, text };
    }
    const json = text ? JSON.parse(text) : {};
    return { ok: true, json };
}
function buildEventPayload(input) {
    const tz = calendarTimeZone();
    const useTeams = input.createTeamsMeeting && !input.meetingLink;
    return {
        subject: input.subject,
        body: {
            contentType: 'HTML',
            content: input.bodyHtml,
        },
        start: { dateTime: toGraphDateTime(input.start), timeZone: tz },
        end: { dateTime: toGraphDateTime(input.end), timeZone: tz },
        ...(input.location ? { location: { displayName: input.location } } : {}),
        attendees: input.attendees.map((a) => ({
            emailAddress: { address: a.email, name: a.name },
            type: 'required',
        })),
        ...(useTeams
            ? {
                isOnlineMeeting: true,
                onlineMeetingProvider: 'teamsForBusiness',
            }
            : {}),
        ...(input.meetingLink && !useTeams
            ? {
                location: { displayName: input.meetingLink },
                body: {
                    contentType: 'HTML',
                    content: `${input.bodyHtml}<p><a href="${input.meetingLink}">Join meeting</a></p>`,
                },
            }
            : {}),
    };
}
export async function createM365InterviewEvent(input) {
    if (!isM365CalendarEnabled())
        return { ok: false, reason: 'not_configured' };
    const organizer = calendarOrganizerEmail();
    const result = await graphRequest(`/users/${encodeURIComponent(organizer)}/events`, {
        method: 'POST',
        body: JSON.stringify(buildEventPayload(input)),
    });
    if (!result.ok) {
        return {
            ok: false,
            reason: 'error',
            message: `Graph create event failed (${result.status}): ${result.text.slice(0, 320)}`,
        };
    }
    const payload = result.json;
    if (!payload.id) {
        return { ok: false, reason: 'error', message: 'Graph create event returned no event id' };
    }
    return {
        ok: true,
        eventId: payload.id,
        meetingLink: payload.onlineMeeting?.joinUrl ?? input.meetingLink,
    };
}
export async function updateM365InterviewEvent(eventId, input) {
    if (!isM365CalendarEnabled())
        return { ok: false, reason: 'not_configured' };
    const organizer = calendarOrganizerEmail();
    const result = await graphRequest(`/users/${encodeURIComponent(organizer)}/events/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        body: JSON.stringify(buildEventPayload(input)),
    });
    if (!result.ok) {
        return {
            ok: false,
            reason: 'error',
            message: `Graph update event failed (${result.status}): ${result.text.slice(0, 320)}`,
        };
    }
    const payload = result.json;
    return {
        ok: true,
        eventId: payload.id ?? eventId,
        meetingLink: payload.onlineMeeting?.joinUrl ?? input.meetingLink,
    };
}
export async function cancelM365InterviewEvent(eventId) {
    if (!isM365CalendarEnabled())
        return { ok: false, reason: 'not_configured' };
    const organizer = calendarOrganizerEmail();
    const result = await graphRequest(`/users/${encodeURIComponent(organizer)}/events/${encodeURIComponent(eventId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
            comment: `Interview cancelled via ${env.appName}.`,
        }),
    });
    if (!result.ok) {
        return {
            ok: false,
            reason: 'error',
            message: `Graph cancel event failed (${result.status}): ${result.text.slice(0, 320)}`,
        };
    }
    return { ok: true, eventId };
}
