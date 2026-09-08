import { prisma } from './prisma.js';
import { getAllowedInterviewerIdsForPlanStageOrder, getPanelInterviewerIdsByOrder, isAdditionalPlanStageOrder, panelRestrictionLabel, } from './interviewPanelCatalog.js';
import { isInterviewSchedulableStatus } from './candidateStatuses.js';
export const DEFAULT_INTERVIEW_STAGES = [
    { name: 'L1 Interview', interviewType: 'TECHNICAL', defaultDuration: 60 },
    { name: 'Managerial Interview', interviewType: 'TECHNICAL', defaultDuration: 60 },
    { name: 'HR Interview', interviewType: 'CULTURAL', defaultDuration: 45 },
];
const FAIL_RECOMMENDATIONS = new Set(['NO_HIRE', 'STRONG_NO_HIRE']);
export function interviewEndTime(scheduledAt, durationMinutes) {
    const end = new Date(scheduledAt);
    end.setMinutes(end.getMinutes() + (durationMinutes ?? 60));
    return end;
}
export function isInterviewPastEnd(scheduledAt, durationMinutes, now = new Date()) {
    return interviewEndTime(scheduledAt, durationMinutes) <= now;
}
export async function ensureInterviewPlan(requirementId, options) {
    const existing = await prisma.interviewPlan.findUnique({
        where: { requirementId },
        include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (existing) {
        const overrides = options?.stageInterviewerIdsByOrder;
        if (overrides && Object.keys(overrides).length > 0) {
            for (const stage of existing.stages) {
                const ids = overrides[stage.order];
                if (!ids)
                    continue;
                await prisma.interviewPlanStage.update({
                    where: { id: stage.id },
                    data: { defaultInterviewerIds: JSON.stringify(ids) },
                });
            }
            return prisma.interviewPlan.findUniqueOrThrow({
                where: { requirementId },
                include: { stages: { orderBy: { order: 'asc' } } },
            });
        }
        return existing;
    }
    const stagesData = await Promise.all(DEFAULT_INTERVIEW_STAGES.map(async (s, order) => {
        const override = options?.stageInterviewerIdsByOrder?.[order];
        const panelIds = override && override.length > 0
            ? override
            : await getPanelInterviewerIdsByOrder(order);
        return {
            order,
            name: s.name,
            interviewType: s.interviewType,
            defaultDuration: s.defaultDuration,
            defaultInterviewerIds: JSON.stringify(panelIds),
        };
    }));
    return prisma.interviewPlan.create({
        data: {
            requirementId,
            stages: { create: stagesData },
        },
        include: { stages: { orderBy: { order: 'asc' } } },
    });
}
export async function ensurePlansForAllRequirements() {
    const reqs = await prisma.requirement.findMany({ select: { id: true } });
    for (const r of reqs) {
        await ensureInterviewPlan(r.id);
    }
}
export function mapPlanResponse(plan) {
    return {
        id: plan.id,
        requirementId: plan.requirementId,
        stages: plan.stages.map((s) => ({
            id: s.id,
            order: s.order,
            name: s.name,
            interviewType: s.interviewType,
            defaultDuration: s.defaultDuration,
            defaultInterviewerIds: JSON.parse(s.defaultInterviewerIds || '[]'),
        })),
    };
}
function latestFeedbackByInterview(feedbackRows) {
    const map = new Map();
    for (const fb of feedbackRows) {
        if (!map.has(fb.interviewId))
            map.set(fb.interviewId, fb);
    }
    return map;
}
function stageInterviewState(interviews, feedbackByInterview, now = new Date()) {
    const active = interviews.filter((i) => i.status !== 'CANCELLED');
    if (active.length === 0)
        return 'available';
    const scheduled = active.find((i) => i.status === 'SCHEDULED' && !isInterviewPastEnd(i.scheduledAt, i.duration, now));
    if (scheduled)
        return 'scheduled';
    const withFeedback = active.filter((i) => feedbackByInterview.has(i.id));
    if (withFeedback.length > 0) {
        const latest = withFeedback[withFeedback.length - 1];
        const rec = feedbackByInterview.get(latest.id).recommendation;
        if (FAIL_RECOMMENDATIONS.has(rec))
            return 'failed';
        return 'completed';
    }
    const needsFeedback = active.some((i) => i.status === 'COMPLETED' ||
        (i.status === 'SCHEDULED' && isInterviewPastEnd(i.scheduledAt, i.duration, now)));
    if (needsFeedback)
        return 'awaiting_feedback';
    return 'available';
}
export function isStageCompleteForFlow(status) {
    return status === 'completed';
}
export async function getCandidateStageProgress(requirementId, candidateId, excludeInterviewId) {
    const plan = await ensureInterviewPlan(requirementId);
    const stages = plan.stages;
    const interviews = await prisma.interview.findMany({
        where: { requirementId, candidateId },
        orderBy: { scheduledAt: 'asc' },
    });
    const interviewIds = interviews.map((i) => i.id);
    const feedbackRows = interviewIds.length > 0
        ? await prisma.feedback.findMany({
            where: { interviewId: { in: interviewIds } },
            orderBy: { createdAt: 'desc' },
        })
        : [];
    const feedbackByInterview = latestFeedbackByInterview(feedbackRows);
    const now = new Date();
    const candidate = await prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { status: true },
    });
    const candidateInInterviewStage = isInterviewSchedulableStatus(candidate?.status ?? '');
    const stageResults = [];
    let allPriorComplete = true;
    for (const stage of stages) {
        const catalogAllowed = await getAllowedInterviewerIdsForPlanStageOrder(stage.order);
        const defaultInterviewerIds = JSON.parse(stage.defaultInterviewerIds || '[]');
        const allowedInterviewerIds = [
            ...new Set([...catalogAllowed, ...defaultInterviewerIds.filter((id) => typeof id === 'string')]),
        ];
        const stageInterviews = interviews
            .filter((iv) => iv.planStageId === stage.id && iv.id !== excludeInterviewId);
        let status = stageInterviewState(stageInterviews, feedbackByInterview, now);
        if (!allPriorComplete && status === 'available')
            status = 'locked';
        const activeInterview = stageInterviews.find((iv) => iv.status !== 'CANCELLED' &&
            iv.status === 'SCHEDULED' &&
            !isInterviewPastEnd(iv.scheduledAt, iv.duration, now));
        const awaitingInterview = stageInterviews.find((iv) => {
            if (iv.status === 'CANCELLED')
                return false;
            if (feedbackByInterview.has(iv.id))
                return false;
            return (iv.status === 'COMPLETED' ||
                (iv.status === 'SCHEDULED' && isInterviewPastEnd(iv.scheduledAt, iv.duration, now)));
        });
        const decidedInterview = [...stageInterviews]
            .filter((iv) => iv.status !== 'CANCELLED' && feedbackByInterview.has(iv.id))
            .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0];
        const canSchedule = candidateInInterviewStage &&
            allPriorComplete &&
            status === 'available' &&
            !activeInterview &&
            !awaitingInterview &&
            allowedInterviewerIds.length > 0;
        stageResults.push({
            id: stage.id,
            order: stage.order,
            name: stage.name,
            interviewType: stage.interviewType,
            defaultDuration: stage.defaultDuration,
            defaultInterviewerIds,
            allowedInterviewerIds,
            usesCombinedPanel: isAdditionalPlanStageOrder(stage.order),
            panelRestrictionLabel: panelRestrictionLabel(stage.order, stage.name),
            status,
            canSchedule,
            interviewId: activeInterview?.id ?? awaitingInterview?.id ?? decidedInterview?.id,
        });
        if (status === 'failed')
            allPriorComplete = false;
        else if (!isStageCompleteForFlow(status))
            allPriorComplete = false;
    }
    const nextSchedulable = stageResults.find((s) => s.canSchedule);
    return {
        planId: plan.id,
        requirementId,
        candidateId,
        candidateInInterviewStage: candidateInInterviewStage ?? false,
        stages: stageResults,
        nextSchedulableStageId: nextSchedulable?.id ?? null,
    };
}
export async function assertCandidateInInterviewStage(candidateId, requirementId) {
    const candidate = await prisma.candidate.findUnique({
        where: { id: candidateId },
        select: { status: true, requirementId: true, name: true },
    });
    if (!candidate) {
        throw new ScheduleStageError('Candidate not found', 404);
    }
    if (!isInterviewSchedulableStatus(candidate.status)) {
        throw new ScheduleStageError('Interviews can only be scheduled for candidates in an active interview pipeline stage (L1, Managerial, Client, or HR).', 403);
    }
    if (requirementId && candidate.requirementId !== requirementId) {
        throw new ScheduleStageError('This candidate is not linked to the selected job requirement. Assign them to this role in the candidate profile first.', 403);
    }
}
export async function assertInterviewerIdsAllowedForStage(stageOrder, interviewerIds, stageName, extraAllowedIds) {
    const catalogAllowed = await getAllowedInterviewerIdsForPlanStageOrder(stageOrder);
    const allowed = [
        ...new Set([
            ...catalogAllowed,
            ...(extraAllowedIds ?? []).filter((id) => typeof id === 'string' && id.trim()),
        ]),
    ];
    if (allowed.length === 0) {
        const panel = panelRestrictionLabel(stageOrder, stageName ?? 'this stage');
        throw new ScheduleStageError(`No interviewers are configured for the ${panel}. Add panel members under Admin → Interview panels, or nominate interviewers on the requirement.`, 403);
    }
    const allowedSet = new Set(allowed);
    const invalid = interviewerIds.filter((id) => !allowedSet.has(id));
    if (invalid.length > 0) {
        const panel = panelRestrictionLabel(stageOrder, stageName ?? 'this stage');
        throw new ScheduleStageError(`Selected interviewer(s) are not on the ${panel}. Choose only panel members for this round.`, 403);
    }
}
export async function assertCanScheduleStage(requirementId, candidateId, planStageId, excludeInterviewId) {
    await assertCandidateInInterviewStage(candidateId, requirementId);
    const plan = await ensureInterviewPlan(requirementId);
    const stage = plan.stages.find((s) => s.id === planStageId);
    if (!stage) {
        throw new ScheduleStageError('Invalid interview stage for this job', 400);
    }
    const progress = await getCandidateStageProgress(requirementId, candidateId, excludeInterviewId);
    const stageProgress = progress.stages.find((s) => s.id === planStageId);
    if (!stageProgress) {
        throw new ScheduleStageError('Stage not found', 400);
    }
    if (excludeInterviewId) {
        return { stage, plan };
    }
    if (!stageProgress.canSchedule) {
        const msg = !progress.candidateInInterviewStage
            ? 'Move the candidate to an active interview stage (L1, Managerial, Client, or HR) before scheduling.'
            : stageProgress.allowedInterviewerIds.length === 0
                ? `No interviewers are configured for the ${stageProgress.panelRestrictionLabel}.`
                : stageProgress.status === 'locked'
                    ? `Complete earlier interview stages before scheduling "${stage.name}".`
                    : stageProgress.status === 'scheduled'
                        ? `"${stage.name}" is already scheduled.`
                        : stageProgress.status === 'awaiting_feedback'
                            ? `Submit feedback for "${stage.name}" before scheduling the next stage.`
                            : stageProgress.status === 'failed'
                                ? `Candidate did not pass "${stage.name}". Cannot schedule later stages.`
                                : `Cannot schedule "${stage.name}" at this time.`;
        throw new ScheduleStageError(msg, 403);
    }
    return { stage, plan };
}
export class ScheduleStageError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ScheduleStageError';
    }
}
const PANEL_MEMBER_ROLES = [
    'INTERVIEWER',
    'HIRING_MANAGER',
    'ACCOUNT_MANAGER',
    'TEAM_LEAD',
    'RECRUITER',
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
];
function parseInterviewerIdList(raw, label) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw)) {
        throw new Error(`${label} must be an array of user IDs`);
    }
    const ids = raw
        .filter((id) => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean);
    return [...new Set(ids)];
}
/**
 * Parse optional L1 / L2 interviewer panels from create-requirement body.
 * Requires at least one interviewer for L1 and L2.
 */
export async function resolveCreateInterviewPanels(body) {
    const l1 = parseInterviewerIdList(body.l1InterviewerIds, 'L1 interview panel');
    const l2 = parseInterviewerIdList(body.l2InterviewerIds, 'L2 interview panel');
    if (l1.length === 0) {
        throw new Error('Select at least one interviewer for the L1 interview panel');
    }
    if (l2.length === 0) {
        throw new Error('Select at least one interviewer for the L2 / Managerial interview panel');
    }
    const allIds = [...new Set([...l1, ...l2])];
    const users = await prisma.user.findMany({
        where: { id: { in: allIds } },
        select: { id: true, role: true, status: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const id of allIds) {
        const user = byId.get(id);
        if (!user) {
            throw new Error('One or more selected interviewers were not found');
        }
        if (user.status !== 'ACTIVE') {
            throw new Error(`${user.name} is not an active user and cannot be on an interview panel`);
        }
        if (!PANEL_MEMBER_ROLES.includes(user.role)) {
            throw new Error(`${user.name} cannot be assigned as an interviewer`);
        }
    }
    return { 0: l1, 1: l2 };
}
