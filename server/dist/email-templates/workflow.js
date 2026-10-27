import { env } from '../config/env.js';
import { renderBlocks } from './blocks.js';
import { renderEmail } from './layout.js';
import { ACCENTS, escapeHtml as esc } from './tokens.js';
/**
 * Workflow mails have admin-editable plain-text bodies (Admin → Email delivery).
 * This turns that text into design blocks:
 *   "- Label : value" lines        → detail rows
 *   "- Label :" + following lines  → document panel (e.g. job description)
 *   {{joinMeetingButton}} etc.     → buttons
 *   "Please note …" / "Note : …"   → callouts
 *   "Hello Name,"                  → greeting
 */
export function fillTemplate(template, values) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? '');
}
const BUTTON_TOKENS = {
    joinMeetingButton: { valueKey: 'meetingLink', label: 'Join meeting' },
    portalButton: { valueKey: 'portalUrl', label: 'Go to portal' },
    acceptInviteButton: { valueKey: 'acceptInviteUrl', label: 'Accept invite' },
    declineInviteButton: { valueKey: 'declineInviteUrl', label: 'Decline' },
};
const linkify = (text) => esc(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" style="font-weight:600;text-decoration:none;">${url}</a>`);
function textToBlocks(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
        if (lines[i].startsWith('- ')) {
            const rows = [];
            while (i < lines.length && lines[i].startsWith('- ')) {
                const raw = lines[i].replace(/^-\s+/, '');
                const at = raw.indexOf(' :');
                rows.push(at >= 0 ? [raw.slice(0, at).trim(), raw.slice(at + 2).trim()] : [raw, '']);
                i += 1;
            }
            const last = rows[rows.length - 1];
            const rest = [];
            while (i < lines.length && !lines[i].startsWith('- '))
                rest.push(lines[i++]);
            if (last && !last[1] && rest.length) {
                rows.pop();
                if (rows.length)
                    blocks.push({ type: 'details', rows });
                blocks.push({ type: 'document', label: last[0], text: rest.join('\n') });
            }
            else {
                blocks.push({ type: 'details', rows });
                if (rest.length)
                    blocks.push({ type: 'p', html: rest.map(linkify).join('<br/>') });
            }
            continue;
        }
        const text = [];
        while (i < lines.length && !lines[i].startsWith('- '))
            text.push(lines[i++]);
        blocks.push({ type: 'p', html: text.map(linkify).join('<br/>') });
    }
    return blocks;
}
export function workflowBodyBlocks(body, values) {
    const origin = env.clientOrigin.replace(/\/$/, '');
    const hrefFor = (token) => {
        const spec = BUTTON_TOKENS[token];
        if (token === 'portalButton')
            return values.portalUrl || `${origin}/staffportal`;
        return values[spec.valueKey] ?? '';
    };
    // Keep button placeholders as markers until after the text is filled.
    const marked = body.replace(/\{\{\s*(joinMeetingButton|portalButton|acceptInviteButton|declineInviteButton)\s*\}\}/g, '[[$1]]');
    const text = fillTemplate(marked, values);
    const blocks = [];
    for (const chunk of text.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean)) {
        const tokens = chunk.split(/\s+/);
        if (tokens.every((t) => /^\[\[\w+\]\]$/.test(t))) {
            const items = tokens
                .map((t) => t.slice(2, -2))
                .filter((name) => name in BUTTON_TOKENS && hrefFor(name))
                .map((name, index) => ({
                label: BUTTON_TOKENS[name].label,
                href: hrefFor(name),
                variant: index === 0 && name !== 'declineInviteButton' ? 'primary' : 'secondary',
            }));
            if (items.length)
                blocks.push({ type: 'actions', items });
            continue;
        }
        const greeting = /^(hello|hi|dear)\s+([^\n]+?),?$/i.exec(chunk);
        if (greeting) {
            blocks.push({ type: 'greeting', name: greeting[2].trim() });
            continue;
        }
        if (chunk.startsWith('Please note')) {
            blocks.push({ type: 'callout', tone: 'info', title: '', html: linkify(chunk).replace(/\n/g, '<br/>') });
            continue;
        }
        if (/^Note\s*:/.test(chunk)) {
            blocks.push({ type: 'callout', tone: 'neutral', title: 'Note', html: linkify(chunk.replace(/^Note\s*:\s*/, '')).replace(/\n/g, '<br/>') });
            continue;
        }
        blocks.push(...textToBlocks(chunk.split('\n').map((l) => l.trim()).filter(Boolean)));
    }
    return blocks;
}
/** Body-only HTML (no shell) — used inside Outlook calendar invites. */
export function renderWorkflowBodyHtml(body, values, audience = 'staff') {
    const style = { width: 520, panelRadius: 12, btnRadius: 10, details: 'panel', secondary: 'outline' };
    return renderBlocks(ACCENTS[audience], style, workflowBodyBlocks(body, values));
}
const initials = (name) => name.trim().split(/\s+/).filter(Boolean).map((p) => p[0]).filter((_, i, all) => i === 0 || i === all.length - 1).join('').toUpperCase();
function dateTile(dateLabel) {
    const match = /(\d{1,2})\s+([A-Za-z]{3})/.exec(dateLabel ?? '');
    return match ? { top: match[2].toUpperCase(), main: match[1] } : undefined;
}
function headerFor(key, values) {
    const req = [values.jobTitle, values.client].filter(Boolean).join(' · ') || undefined;
    const candidate = [values.candidateName, values.jobTitle].filter(Boolean).join(' · ') || undefined;
    switch (key) {
        case 'requirementRaised': return { eyebrow: 'Requirement', tile: { main: '+' }, subtitle: req };
        case 'requirementApproved': return { eyebrow: 'Requirement', tile: { main: '&#10003;' }, subtitle: req };
        case 'recruiterAssigned': return { eyebrow: 'Assigned to you', tile: { main: '&rarr;' }, subtitle: req };
        case 'recruiterAccepted': return { eyebrow: 'Requirement', tile: { main: '&#10003;' }, subtitle: req };
        case 'requirementUpdated': return { eyebrow: 'Requirement', tile: { main: '&#9998;' }, subtitle: req };
        case 'requirementStageChanged': return { eyebrow: 'Hiring stage', tile: { main: '&rarr;' }, subtitle: req };
        case 'candidateCreated': return { eyebrow: 'Candidate', tile: { top: 'NEW', main: initials(values.candidateName ?? '') || '+' }, subtitle: candidate };
        case 'interviewScheduledCandidate': return { eyebrow: 'Interview invitation', subtitle: [values.jobTitle, values.interviewRound].filter(Boolean).join(' · ') };
        case 'interviewScheduledPanel': return { eyebrow: 'Interview panel', tile: dateTile(values.interviewDate) ?? { main: '&#9679;' }, subtitle: candidate };
        case 'interviewRsvpAccepted': return { eyebrow: 'Interview RSVP', tile: { main: '&#10003;' }, subtitle: candidate };
        case 'interviewRsvpDeclined': return { eyebrow: 'Interview RSVP', tile: { main: '&#10005;' }, subtitle: candidate };
        case 'interviewFeedback': return { eyebrow: 'Interview feedback', tile: { top: 'RATING', main: esc(values.rating || '–') }, subtitle: candidate };
        default: return { eyebrow: 'Workflow', subtitle: req };
    }
}
/** Full workflow email. The candidate invitation uses the candidate Portal layout; all others are staff Tonal. */
export function renderWorkflowEmail(key, title, body, values) {
    const header = headerFor(key, values);
    const candidate = key === 'interviewScheduledCandidate';
    return renderEmail({
        audience: candidate ? 'candidate' : 'staff',
        eyebrow: header.eyebrow,
        title: candidate ? 'You’re invited to interview' : title,
        subtitle: header.subtitle,
        tile: header.tile,
        blocks: workflowBodyBlocks(body, values),
    });
}
