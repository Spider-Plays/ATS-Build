function escapeIcsText(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}
function formatIcsUtc(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return (`${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
        `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`);
}
function foldIcsLine(line) {
    const max = 75;
    if (line.length <= max)
        return line;
    const parts = [line.slice(0, max)];
    let offset = max;
    while (offset < line.length) {
        parts.push(` ${line.slice(offset, offset + max - 1)}`);
        offset += max - 1;
    }
    return parts.join('\r\n');
}
export function buildInterviewIcs(event) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Stitch ATS//Interview Scheduler//EN',
        `METHOD:${event.method}`,
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${escapeIcsText(event.uid)}`,
        `DTSTAMP:${formatIcsUtc(new Date())}`,
        `DTSTART:${formatIcsUtc(event.start)}`,
        `DTEND:${formatIcsUtc(event.end)}`,
        foldIcsLine(`SUMMARY:${escapeIcsText(event.summary)}`),
        foldIcsLine(`DESCRIPTION:${escapeIcsText(event.description)}`),
        `SEQUENCE:${event.sequence}`,
        `STATUS:${event.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
        foldIcsLine(`ORGANIZER;CN=${escapeIcsText(event.organizerName)}:mailto:${event.organizerEmail}`),
    ];
    if (event.location) {
        lines.push(foldIcsLine(`LOCATION:${escapeIcsText(event.location)}`));
    }
    if (event.meetingLink) {
        lines.push(foldIcsLine(`URL:${escapeIcsText(event.meetingLink)}`));
    }
    for (const attendee of event.attendees) {
        lines.push(foldIcsLine(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${escapeIcsText(attendee.name)}:mailto:${attendee.email}`));
    }
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return `${lines.join('\r\n')}\r\n`;
}
export function interviewCalendarUid(interviewId) {
    return `interview-${interviewId}@ats.igsglobal.co`;
}
export function interviewEndTime(scheduledAt, durationMinutes) {
    const end = new Date(scheduledAt);
    end.setMinutes(end.getMinutes() + (durationMinutes ?? 60));
    return end;
}
