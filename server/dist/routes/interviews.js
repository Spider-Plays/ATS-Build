import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { mapInterview } from '../utils/mappers.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { logActivity, logCandidateInterviewActivity } from '../services/activityLog.js';
import { INTERNAL_ROLES, INTERVIEW_SCHEDULERS } from '../lib/roles.js';
import { notifyInterviewCancelled, notifyInterviewScheduled, notifyInterviewUpdated, prepareInterviewCalendar, } from '../lib/emailDispatch.js';
import { assertCanScheduleStage, assertCandidateInInterviewStage, assertInterviewerIdsAllowedForStage, ScheduleStageError, } from '../lib/interviewPlan.js';
import { assertCanViewCandidate, assertCanViewInterview, buildInterviewListWhere, CandidateAccessError, } from '../lib/candidateAccess.js';
import { loadCandidateResume } from '../lib/candidateResume.js';
import { isAdditionalPlanStageOrder, listInterviewPanelLevels, } from '../lib/interviewPanelCatalog.js';
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
function interviewEndTime(scheduledAt, durationMinutes) {
    const end = new Date(scheduledAt);
    end.setMinutes(end.getMinutes() + (durationMinutes ?? 60));
    return end;
}
function interviewDetailsWillChange(body, existing) {
    if (body.scheduledAt !== undefined && new Date(String(body.scheduledAt)).getTime() !== existing.scheduledAt.getTime()) {
        return true;
    }
    if (body.meetingLink !== undefined && (body.meetingLink || null) !== existing.meetingLink)
        return true;
    if (body.type !== undefined && body.type !== existing.type)
        return true;
    if (body.duration !== undefined && body.duration !== existing.duration)
        return true;
    if (body.location !== undefined && (body.location || null) !== existing.location)
        return true;
    if (body.description !== undefined && (body.description || null) !== existing.description)
        return true;
    if (body.interviewerIds !== undefined) {
        const next = JSON.stringify(body.interviewerIds);
        if (next !== existing.interviewerIds)
            return true;
    }
    return false;
}
async function markPastScheduledAsCompleted(rows) {
    const now = new Date();
    const toComplete = rows.filter((r) => r.status === 'SCHEDULED' && interviewEndTime(r.scheduledAt, r.duration) <= now);
    if (toComplete.length === 0)
        return rows;
    await prisma.interview.updateMany({
        where: { id: { in: toComplete.map((r) => r.id) } },
        data: { status: 'COMPLETED' },
    });
    const completedIds = new Set(toComplete.map((r) => r.id));
    return rows.map((r) => completedIds.has(r.id) ? { ...r, status: 'COMPLETED' } : r);
}
async function enrichInterviews(rows) {
    const normalized = await markPastScheduledAsCompleted(rows);
    const interviewIds = normalized.map((r) => r.id);
    const candidateIds = [...new Set(normalized.map((r) => r.candidateId))];
    const stageIds = [...new Set(normalized.map((r) => r.planStageId).filter(Boolean))];
    const interviewerIds = [
        ...new Set(normalized.flatMap((r) => {
            try {
                return JSON.parse(r.interviewerIds || '[]');
            }
            catch {
                return [];
            }
        })),
    ];
    const [candidates, feedbackRows, planStages, interviewers, panelLevels] = await Promise.all([
        prisma.candidate.findMany({
            where: { id: { in: candidateIds } },
            select: {
                id: true,
                name: true,
                role: true,
                email: true,
                resumeUrl: true,
                resumeFileName: true,
            },
        }),
        interviewIds.length > 0
            ? prisma.feedback.findMany({
                where: { interviewId: { in: interviewIds } },
                orderBy: { createdAt: 'desc' },
            })
            : Promise.resolve([]),
        stageIds.length > 0
            ? prisma.interviewPlanStage.findMany({ where: { id: { in: stageIds } } })
            : Promise.resolve([]),
        interviewerIds.length > 0
            ? prisma.user.findMany({
                where: { id: { in: interviewerIds } },
                select: { id: true, name: true },
            })
            : Promise.resolve([]),
        listInterviewPanelLevels().catch(() => []),
    ]);
    const candidateById = new Map(candidates.map((c) => [c.id, c]));
    const stageById = new Map(planStages.map((s) => [s.id, s]));
    const interviewerNameById = new Map(interviewers.map((u) => [u.id, u.name]));
    const panelNameByOrder = new Map(panelLevels.map((l) => [l.order, l.name]));
    const latestFeedbackByInterview = new Map();
    for (const fb of feedbackRows) {
        if (!latestFeedbackByInterview.has(fb.interviewId)) {
            latestFeedbackByInterview.set(fb.interviewId, fb);
        }
    }
    return normalized.map((row) => {
        const c = candidateById.get(row.candidateId);
        const fb = latestFeedbackByInterview.get(row.id);
        const stage = row.planStageId ? stageById.get(row.planStageId) : undefined;
        const mapped = mapInterview(row);
        const interviewerNames = mapped.interviewerIds
            .map((id) => interviewerNameById.get(id))
            .filter((name) => Boolean(name));
        const panelName = stage?.order != null
            ? isAdditionalPlanStageOrder(stage.order)
                ? 'Combined panel'
                : panelNameByOrder.get(stage.order) ?? stage.name
            : undefined;
        return {
            ...mapped,
            stageName: stage?.name,
            stageOrder: stage?.order,
            panelName,
            interviewerNames,
            candidateName: c?.name,
            candidateRole: c?.role,
            candidateEmail: c?.email,
            candidateHasResume: !!(c?.resumeUrl || c?.resumeFileName),
            hasFeedback: !!fb,
            feedbackRecommendation: fb?.recommendation,
        };
    });
}
router.get('/', async (req, res) => {
    const listWhere = await buildInterviewListWhere(req.auth);
    const rows = await prisma.interview.findMany({
        where: listWhere,
        orderBy: { scheduledAt: 'desc' },
    });
    res.json(await enrichInterviews(rows));
});
router.get('/by-candidate/:candidateId', async (req, res) => {
    try {
        await assertCanViewCandidate(req.auth, req.params.candidateId);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    // AND scope with candidateId — do not spread list-where over candidateId
    // (recruiters get { candidateId: { in: [...] } } which would overwrite the param).
    const scopeWhere = await buildInterviewListWhere(req.auth);
    const rows = await prisma.interview.findMany({
        where: {
            AND: [{ candidateId: req.params.candidateId }, scopeWhere],
        },
        orderBy: { scheduledAt: 'desc' },
    });
    res.json(await enrichInterviews(rows));
});
router.get('/:id/candidate-resume', async (req, res) => {
    try {
        const interview = await prisma.interview.findUnique({ where: { id: req.params.id } });
        if (!interview)
            return res.status(404).json({ error: 'Interview not found' });
        await assertCanViewInterview(req.auth, req.params.id);
        const row = await prisma.candidate.findUnique({ where: { id: interview.candidateId } });
        if (!row)
            return res.status(404).json({ error: 'Candidate not found' });
        if (!row.resumeFileName)
            return res.status(404).json({ error: 'No resume uploaded' });
        const loaded = await loadCandidateResume(row);
        if (!loaded)
            return res.status(404).json({ error: 'Resume file missing' });
        res.setHeader('Content-Type', loaded.mime);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(loaded.fileName)}"`);
        res.send(loaded.buffer);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        console.error('Interview candidate resume failed:', err);
        res.status(500).json({ error: 'Failed to load resume' });
    }
});
router.get('/:id', async (req, res) => {
    const row = await prisma.interview.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewInterview(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const [enriched] = await enrichInterviews([row]);
    res.json(enriched);
});
router.post('/', requireRoles(...INTERVIEW_SCHEDULERS), async (req, res) => {
    const body = req.body;
    const planStageId = typeof body.planStageId === 'string' ? body.planStageId : '';
    if (!planStageId) {
        return res.status(400).json({ error: 'Interview stage is required' });
    }
    try {
        const { stage } = await assertCanScheduleStage(body.requirementId, body.candidateId, planStageId);
        const interviewerIds = Array.isArray(body.interviewerIds) ? body.interviewerIds : [];
        if (interviewerIds.length === 0) {
            return res.status(400).json({ error: 'Select at least one interviewer' });
        }
        await assertInterviewerIdsAllowedForStage(stage.order, interviewerIds, stage.name, JSON.parse(stage.defaultInterviewerIds || '[]'));
        const interviewType = body.type ?? stage.interviewType;
        const createOnlineMeeting = body.createOnlineMeeting !== false;
        const meetingLinkRaw = typeof body.meetingLink === 'string' ? body.meetingLink.trim() : '';
        const locationRaw = typeof body.location === 'string' ? body.location.trim() : '';
        const meetingLink = createOnlineMeeting ? meetingLinkRaw || null : null;
        const location = createOnlineMeeting ? null : locationRaw || null;
        const row = await prisma.interview.create({
            data: {
                candidateId: body.candidateId,
                requirementId: body.requirementId,
                planStageId,
                scheduledAt: new Date(body.scheduledAt),
                scheduledBy: req.auth.userId,
                interviewerIds: JSON.stringify(interviewerIds),
                type: interviewType,
                status: body.status ?? 'SCHEDULED',
                meetingLink,
                duration: body.duration ?? stage.defaultDuration,
                location,
                description: body.description,
            },
        });
        await sendScheduledAndRespond(res, row, body, req, { createOnlineMeeting });
    }
    catch (err) {
        if (err instanceof ScheduleStageError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        throw err;
    }
});
async function sendScheduledAndRespond(res, row, body, req, calendarOptions) {
    const synced = await prepareInterviewCalendar(row, calendarOptions);
    notifyInterviewScheduled({
        id: synced.id,
        type: synced.type,
        scheduledAt: synced.scheduledAt,
        meetingLink: synced.meetingLink,
        location: synced.location,
        description: synced.description,
        duration: synced.duration,
        interviewerIds: synced.interviewerIds,
        candidateId: synced.candidateId,
        requirementId: synced.requirementId,
        calendarEventId: synced.calendarEventId,
        calendarSequence: synced.calendarSequence,
        planStageId: synced.planStageId,
    });
    const stage = row.planStageId
        ? await prisma.interviewPlanStage.findUnique({ where: { id: row.planStageId } })
        : null;
    await logActivity({
        entityType: 'INTERVIEW',
        entityId: row.id,
        action: 'SCHEDULED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { candidateId: body.candidateId, type: row.type, planStageId: row.planStageId },
    });
    await logCandidateInterviewActivity({
        candidateId: String(body.candidateId),
        interviewId: row.id,
        action: 'INTERVIEW_SCHEDULED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {
            stageName: stage?.name ?? row.type.replace(/_/g, ' '),
            scheduledAt: row.scheduledAt.toISOString(),
            type: row.type,
        },
    });
    const [enriched] = await enrichInterviews([synced]);
    res.status(201).json(enriched);
}
router.patch('/:id', requireRoles(...INTERVIEW_SCHEDULERS), async (req, res) => {
    const existing = await prisma.interview.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewInterview(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const feedbackCount = await prisma.feedback.count({ where: { interviewId: req.params.id } });
    if (feedbackCount > 0) {
        return res.status(403).json({ error: 'Interview cannot be edited after feedback has been submitted' });
    }
    const body = req.body;
    const nextCandidateId = body.candidateId ?? existing.candidateId;
    const nextRequirementId = body.requirementId ?? existing.requirementId;
    const nextPlanStageId = body.planStageId ?? existing.planStageId;
    if (nextPlanStageId && (nextPlanStageId !== existing.planStageId || nextCandidateId !== existing.candidateId)) {
        try {
            await assertCanScheduleStage(nextRequirementId, nextCandidateId, nextPlanStageId, req.params.id);
        }
        catch (err) {
            if (err instanceof ScheduleStageError) {
                return res.status(err.statusCode).json({ error: err.message });
            }
            throw err;
        }
    }
    else if (!nextPlanStageId && existing.planStageId) {
        return res.status(400).json({ error: 'Interview stage is required' });
    }
    try {
        await assertCandidateInInterviewStage(nextCandidateId, nextRequirementId);
    }
    catch (err) {
        if (err instanceof ScheduleStageError) {
            return res.status(err.statusCode).json({ error: err.message });
        }
        throw err;
    }
    const stageForPanel = nextPlanStageId
        ? await prisma.interviewPlanStage.findUnique({ where: { id: nextPlanStageId } })
        : null;
    if (body.interviewerIds !== undefined && stageForPanel) {
        const interviewerIds = Array.isArray(body.interviewerIds) ? body.interviewerIds : [];
        if (interviewerIds.length === 0) {
            return res.status(400).json({ error: 'Select at least one interviewer' });
        }
        try {
            await assertInterviewerIdsAllowedForStage(stageForPanel.order, interviewerIds, stageForPanel.name, JSON.parse(stageForPanel.defaultInterviewerIds || '[]'));
        }
        catch (err) {
            if (err instanceof ScheduleStageError) {
                return res.status(err.statusCode).json({ error: err.message });
            }
            throw err;
        }
    }
    const data = {};
    if (body.candidateId !== undefined)
        data.candidateId = body.candidateId;
    if (body.requirementId !== undefined)
        data.requirementId = body.requirementId;
    if (body.planStageId !== undefined)
        data.planStageId = body.planStageId;
    if (body.scheduledAt !== undefined)
        data.scheduledAt = new Date(body.scheduledAt);
    if (body.interviewerIds !== undefined) {
        data.interviewerIds = JSON.stringify(body.interviewerIds);
    }
    if (body.type !== undefined)
        data.type = body.type;
    if (body.status !== undefined)
        data.status = body.status;
    if (body.meetingLink !== undefined)
        data.meetingLink = body.meetingLink || null;
    if (body.duration !== undefined)
        data.duration = body.duration;
    if (body.location !== undefined)
        data.location = body.location || null;
    if (body.description !== undefined)
        data.description = body.description || null;
    if (body.createOnlineMeeting === false) {
        data.meetingLink = null;
    }
    if (interviewDetailsWillChange(body, existing)) {
        data.calendarSequence = existing.calendarSequence + 1;
    }
    const row = await prisma.interview.update({ where: { id: req.params.id }, data });
    const rescheduled = body.scheduledAt !== undefined &&
        new Date(body.scheduledAt).getTime() !== existing.scheduledAt.getTime();
    const interviewDetailsChanged = interviewDetailsWillChange(body, existing);
    let synced = row;
    if (interviewDetailsChanged) {
        const createOnlineMeeting = body.createOnlineMeeting !== undefined
            ? body.createOnlineMeeting !== false
            : Boolean(existing.meetingLink);
        synced = await prepareInterviewCalendar(row, {
            createOnlineMeeting,
        });
        notifyInterviewUpdated({
            id: synced.id,
            type: synced.type,
            scheduledAt: synced.scheduledAt,
            meetingLink: synced.meetingLink,
            location: synced.location,
            description: synced.description,
            duration: synced.duration,
            interviewerIds: synced.interviewerIds,
            candidateId: synced.candidateId,
            requirementId: synced.requirementId,
            calendarEventId: synced.calendarEventId,
            calendarSequence: synced.calendarSequence,
            planStageId: synced.planStageId,
        }, { rescheduled });
    }
    const stage = row.planStageId
        ? await prisma.interviewPlanStage.findUnique({ where: { id: row.planStageId } })
        : null;
    await logActivity({
        entityType: 'INTERVIEW',
        entityId: row.id,
        action: rescheduled ? 'RESCHEDULED' : 'UPDATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: rescheduled
            ? { scheduledAt: row.scheduledAt.toISOString() }
            : undefined,
    });
    await logCandidateInterviewActivity({
        candidateId: row.candidateId,
        interviewId: row.id,
        action: rescheduled ? 'INTERVIEW_RESCHEDULED' : 'INTERVIEW_UPDATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {
            stageName: stage?.name,
            scheduledAt: row.scheduledAt.toISOString(),
            type: row.type,
        },
    });
    const [enriched] = await enrichInterviews([synced]);
    res.json(enriched);
});
router.patch('/:id/status', requireRoles(...INTERVIEW_SCHEDULERS), async (req, res) => {
    const existing = await prisma.interview.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewInterview(req.auth, req.params.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const row = await prisma.interview.update({
        where: { id: req.params.id },
        data: { status: req.body.status },
    });
    const stage = row.planStageId
        ? await prisma.interviewPlanStage.findUnique({ where: { id: row.planStageId } })
        : null;
    await logActivity({
        entityType: 'INTERVIEW',
        entityId: row.id,
        action: 'STATUS_CHANGED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { status: req.body.status },
    });
    const status = String(req.body.status ?? '');
    if (status === 'CANCELLED') {
        const cancelledRow = await prisma.interview.update({
            where: { id: row.id },
            data: { calendarSequence: row.calendarSequence + 1 },
        });
        notifyInterviewCancelled({
            id: cancelledRow.id,
            type: cancelledRow.type,
            scheduledAt: cancelledRow.scheduledAt,
            meetingLink: cancelledRow.meetingLink,
            location: cancelledRow.location,
            description: cancelledRow.description,
            duration: cancelledRow.duration,
            interviewerIds: cancelledRow.interviewerIds,
            candidateId: cancelledRow.candidateId,
            requirementId: cancelledRow.requirementId,
            calendarEventId: cancelledRow.calendarEventId,
            calendarSequence: cancelledRow.calendarSequence,
            planStageId: cancelledRow.planStageId,
        });
        await logCandidateInterviewActivity({
            candidateId: row.candidateId,
            interviewId: row.id,
            action: 'INTERVIEW_CANCELLED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: {
                stageName: stage?.name,
                scheduledAt: row.scheduledAt.toISOString(),
                type: row.type,
            },
        });
    }
    const [enriched] = await enrichInterviews([row]);
    res.json(enriched);
});
router.delete('/:id', requireRoles('ADMIN'), async (req, res) => {
    await prisma.interview.delete({ where: { id: req.params.id } });
    res.status(204).send();
});
export default router;
