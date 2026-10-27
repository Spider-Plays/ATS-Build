import { applyDocumentCsp } from '../lib/authResponse.js';
import express, { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { logActivity } from '../services/activityLog.js';
import { readInterviewRsvpToken } from '../lib/interviewRsvp.js';
import { releasePrivateBusyHold } from '../lib/interviewCalendar.js';
import { queueWorkflow, requirementMailValues, sendWorkflowMail } from '../lib/workflowMail.js';
const router = Router();
router.use((_req, res, next) => {
    applyDocumentCsp(res, { allowForm: true });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});
function page(title, message) {
    return `<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;padding:48px;color:#1a2b3c"><h1>${title}</h1><p>${message}</p></body></html>`;
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function tokenFrom(req) {
    const fromBody = typeof req.body?.token === 'string' ? req.body.token : '';
    const fromQuery = typeof req.query.token === 'string' ? req.query.token : '';
    return fromBody || fromQuery;
}
const INVALID_LINK = 'This interview response link is not valid or has expired.';
// GET only asks for confirmation, so mail link scanners that open the link record nothing.
router.get('/', (req, res) => {
    const token = tokenFrom(req);
    const parsed = readInterviewRsvpToken(token);
    if (!parsed)
        return res.status(400).send(page('Link not valid', INVALID_LINK));
    const verb = parsed.response === 'accept' ? 'Accept' : 'Decline';
    res.send(page(`${verb} interview invitation`, `<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"/>` +
        `<button type="submit" style="font:inherit;padding:10px 20px;border:0;border-radius:8px;background:#1a2b3c;color:#fff;cursor:pointer">${verb} interview</button></form>`));
});
router.post('/', express.urlencoded({ extended: false, limit: '4kb' }), async (req, res) => {
    const parsed = readInterviewRsvpToken(tokenFrom(req));
    if (!parsed)
        return res.status(400).send(page('Link not valid', INVALID_LINK));
    const interview = await prisma.interview.findUnique({ where: { id: parsed.interviewId } });
    if (!interview || interview.status === 'CANCELLED') {
        return res.status(404).send(page('Interview not available', 'This interview is no longer on the calendar.'));
    }
    const candidate = await prisma.candidate.findUnique({
        where: { id: interview.candidateId },
        select: { name: true, email: true },
    });
    const isCandidate = candidate?.email?.trim().toLowerCase() === parsed.email;
    let respondentName = candidate?.name ?? parsed.email;
    if (!isCandidate) {
        const user = await prisma.user.findFirst({
            where: { email: { equals: parsed.email, mode: 'insensitive' }, status: 'ACTIVE' },
            select: { name: true },
        });
        if (!user)
            return res.status(403).send(page('Link not valid', 'This response link does not match an invited person.'));
        respondentName = user.name;
    }
    await logActivity({
        entityType: 'INTERVIEW',
        entityId: interview.id,
        action: parsed.response === 'accept' ? 'INVITE_ACCEPTED' : 'INVITE_DECLINED',
        performedBy: parsed.email,
        performerName: respondentName,
        details: { email: parsed.email, response: parsed.response, role: isCandidate ? 'Candidate' : 'Panel' },
    });
    if (parsed.response === 'decline') {
        await releasePrivateBusyHold(interview.id, parsed.email);
    }
    queueWorkflow((async () => {
        const packed = await requirementMailValues(interview.requirementId, {
            candidateName: candidate?.name ?? '',
            scheduledAt: interview.scheduledAt.toLocaleString(),
            interviewRound: interview.type.replace(/_/g, ' '),
            respondentName,
            respondentRole: isCandidate ? 'Candidate' : 'Panel',
        });
        if (!packed)
            return;
        await sendWorkflowMail({
            key: parsed.response === 'accept' ? 'interviewRsvpAccepted' : 'interviewRsvpDeclined',
            context: { requirementId: interview.requirementId, recruiterIds: packed.recruiterIds, values: packed.values },
        });
    })());
    const verb = parsed.response === 'accept' ? 'accepted' : 'declined';
    res.send(page('Response recorded', `You ${verb} this interview. The recruiter has been notified.`));
});
export default router;
