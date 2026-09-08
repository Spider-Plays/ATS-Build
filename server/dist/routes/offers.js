import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { syncRequirementHiringState } from '../lib/hiring.js';
import { mapOffer } from '../utils/mappers.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { logActivity } from '../services/activityLog.js';
import { INTERNAL_ROLES, OFFER_EXEC_APPROVERS, OFFER_HR_APPROVERS, OFFER_ROLES, OFFER_VIEW_ROLES, } from '../lib/roles.js';
import { isOfferEligibleStatus } from '../lib/candidateStatuses.js';
import { assertCanViewCandidate, assertCanViewOffer, buildOfferListWhere, CandidateAccessError, } from '../lib/candidateAccess.js';
import { sendOfferSentEmail } from '../services/email.js';
import { notifyOfferApproved, notifyOfferPendingExecApproval, notifyOfferRejected, notifyOfferStatusChange, notifyOfferSubmittedForApproval, } from '../lib/emailDispatch.js';
import { buildOfferApprovalRecord, parseOfferApprovalBody, assertApprovalCommentRequired, } from '../lib/offerApproval.js';
import { appendApprovalHistory, appendOfferHistory, buildOfferCreateData, loadOfferLetterContext, } from '../lib/offerActions.js';
import { getOfferApprovalRollbackTarget } from '../lib/offerApprovalRollback.js';
import { assertCanApproveOfferExec, assertCanApproveOfferHr, assertCanSendOffer, assertCanSubmitOffer, nextStatusAfterHrApproval, } from '../lib/offerPermissions.js';
import { parseApprovalChainJson, serializeApprovalChain, usesApprovalChain, validateApprovalChain, getSubmitStateForChain, getCurrentStage, nextStatusAfterStageApproval, } from '../lib/offerApprovalChain.js';
import { assertCanApproveOfferStage, assertCanEditOffer, } from '../lib/offerPermissions.js';
import { canEditOfferDetails } from '../lib/offerTransitions.js';
import { calculateCompensationBreakdown, getAnnualCtcFromOffer, } from '../lib/offerCompensation.js';
import { parseLetterMetaJson } from '../lib/offerLetterRender.js';
import { getCompensationConfig } from '../lib/offerSettings.js';
import { env } from '../config/env.js';
import { renderHtmlToPdf } from '../lib/offerPdf.js';
import { ensureCandidatePortalAccount } from '../lib/candidatePortalAccount.js';
import { logTemporaryPassword } from '../lib/devPasswordLog.js';
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
const requireOfferViewer = requireRoles(...OFFER_VIEW_ROLES);
router.get('/pending', requireOfferViewer, async (req, res) => {
    const step = req.query.step;
    const listWhere = await buildOfferListWhere(req.auth);
    let statusFilter;
    if (step === 'exec') {
        statusFilter = 'PENDING_EXEC_APPROVAL';
    }
    else if (step === 'chain') {
        statusFilter = 'PENDING_APPROVAL';
    }
    else {
        statusFilter = { in: ['PENDING_HR_APPROVAL', 'PENDING_APPROVAL'] };
    }
    const rows = await prisma.offer.findMany({
        where: { ...listWhere, status: statusFilter },
        orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(mapOffer));
});
router.post('/preview-compensation', requireRoles(...OFFER_ROLES), async (req, res) => {
    const annualCtc = Number(req.body.annualCtc);
    if (!annualCtc || annualCtc < 1000) {
        return res.status(400).json({ error: 'annualCtc must be at least 1000' });
    }
    const config = await getCompensationConfig();
    res.json(calculateCompensationBreakdown(annualCtc, config));
});
router.get('/', requireOfferViewer, async (req, res) => {
    const listWhere = await buildOfferListWhere(req.auth);
    const rows = await prisma.offer.findMany({
        where: listWhere,
        orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(mapOffer));
});
router.get('/by-candidate/:candidateId', requireOfferViewer, async (req, res) => {
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
    // (scoped roles get { candidateId: { in: [...] } } which would overwrite the param).
    const listWhere = await buildOfferListWhere(req.auth);
    const rows = await prisma.offer.findMany({
        where: {
            AND: [{ candidateId: req.params.candidateId }, listWhere],
        },
        orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(mapOffer));
});
router.get('/:id/letter', requireOfferViewer, async (req, res) => {
    try {
        const ctx = await loadOfferLetterContext(req.params.id);
        if (!ctx)
            return res.status(404).json({ error: 'Not found' });
        await assertCanViewOffer(req.auth, ctx.offer.id);
        res.type('html').send(ctx.letterHtml);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        console.error('Offer letter preview failed:', err);
        return res.status(500).json({ error: 'Failed to render offer letter preview' });
    }
});
router.get('/:id/letter/pdf', requireOfferViewer, async (req, res) => {
    try {
        const ctx = await loadOfferLetterContext(req.params.id);
        if (!ctx)
            return res.status(404).json({ error: 'Not found' });
        await assertCanViewOffer(req.auth, ctx.offer.id);
        const pdf = await renderHtmlToPdf(ctx.letterHtml);
        const safeName = ctx.candidate.name.replace(/[^\w.-]+/g, '_').slice(0, 80);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="offer-${safeName}.pdf"`);
        res.send(pdf);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        console.error('Offer letter PDF failed:', err);
        return res.status(500).json({ error: 'Failed to generate offer letter PDF' });
    }
});
router.get('/:id', requireOfferViewer, async (req, res) => {
    const row = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, row.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    res.json(mapOffer(row));
});
router.post('/', requireRoles(...OFFER_ROLES), async (req, res) => {
    const body = req.body;
    const candidate = await prisma.candidate.findUnique({ where: { id: body.candidateId } });
    if (!candidate)
        return res.status(400).json({ error: 'Candidate not found' });
    try {
        await assertCanViewCandidate(req.auth, body.candidateId);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    if (!isOfferEligibleStatus(candidate.status)) {
        return res.status(400).json({
            error: 'Move the candidate to To be offered (or Offered) in the pipeline before creating an offer.',
        });
    }
    const requirement = await prisma.requirement.findUnique({
        where: { id: body.requirementId },
    });
    if (!requirement)
        return res.status(400).json({ error: 'Requirement not found' });
    const createdAt = new Date().toISOString();
    const approvalChain = body.approvalChain;
    if (approvalChain) {
        const chainError = validateApprovalChain(approvalChain);
        if (chainError)
            return res.status(400).json({ error: chainError });
    }
    const data = await buildOfferCreateData({
        candidateId: body.candidateId,
        requirementId: body.requirementId,
        annualCtc: body.annualCtc ?? body.baseSalary,
        bonus: body.bonus,
        letterMeta: body.letterMeta,
        createdBy: req.auth.userId,
        approvalChain,
    });
    const row = await prisma.offer.create({
        data: {
            ...data,
            history: JSON.stringify([
                {
                    id: crypto.randomUUID(),
                    date: createdAt,
                    action: 'CREATED',
                    description: 'Offer draft created',
                    userId: req.auth.userId,
                },
            ]),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'CREATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { candidateId: body.candidateId, candidateName: candidate.name },
    });
    res.status(201).json(mapOffer(row));
});
router.patch('/:id', requireRoles(...OFFER_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    if (req.body.status !== undefined) {
        return res.status(400).json({
            error: 'Use dedicated endpoints for status transitions (submit, approve, send, etc.)',
        });
    }
    if (!canEditOfferDetails(req.auth.role, existing.status)) {
        return res.status(400).json({ error: 'You cannot edit this offer at its current stage' });
    }
    try {
        assertCanEditOffer(req.auth, existing);
    }
    catch (e) {
        return res.status(403).json({ error: e instanceof Error ? e.message : 'Not allowed' });
    }
    const approvalChain = req.body.approvalChain;
    if (approvalChain) {
        const chainError = validateApprovalChain(approvalChain);
        if (chainError)
            return res.status(400).json({ error: chainError });
    }
    const annualCtc = req.body.annualCtc !== undefined
        ? Number(req.body.annualCtc)
        : req.body.baseSalary !== undefined
            ? Number(req.body.baseSalary)
            : getAnnualCtcFromOffer(existing);
    const letterMeta = req.body.letterMeta;
    const prevMeta = parseLetterMetaJson(existing.letterMetaJson);
    const mergedMeta = letterMeta ? { ...prevMeta, ...letterMeta } : prevMeta;
    const compConfig = await getCompensationConfig();
    const bonusUpdate = req.body.bonus !== undefined
        ? req.body.bonus == null || req.body.bonus === ''
            ? null
            : Number(req.body.bonus) > 0
                ? Number(req.body.bonus)
                : null
        : undefined;
    const row = await prisma.offer.update({
        where: { id: req.params.id },
        data: {
            ...(annualCtc > 0 && {
                annualCtc,
                baseSalary: annualCtc,
                compensationJson: JSON.stringify(calculateCompensationBreakdown(annualCtc, compConfig)),
            }),
            ...(bonusUpdate !== undefined && { bonus: bonusUpdate }),
            ...(letterMeta && {
                letterMetaJson: JSON.stringify(mergedMeta),
            }),
            ...(approvalChain && {
                approvalChainJson: serializeApprovalChain(approvalChain),
            }),
            ...(req.body.letterContent !== undefined && { letterContent: req.body.letterContent }),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'UPDATED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
    });
    res.json(mapOffer(row));
});
router.post('/:id/submit', requireRoles(...OFFER_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    try {
        assertCanSubmitOffer(req.auth, existing);
    }
    catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'Cannot submit' });
    }
    if (usesApprovalChain(existing)) {
        const chain = parseApprovalChainJson(existing.approvalChainJson);
        const chainError = validateApprovalChain(chain);
        if (chainError)
            return res.status(400).json({ error: chainError });
        const submitState = getSubmitStateForChain(chain);
        const firstStage = chain.stages[0];
        const record = buildOfferApprovalRecord('REQUESTED', req.auth, firstStage.label);
        const row = await prisma.offer.update({
            where: { id: req.params.id },
            data: {
                status: submitState.status,
                approvalStep: submitState.approvalStep,
                approval: JSON.stringify(record.approval),
                approvalHistory: appendApprovalHistory(existing.approvalHistory, record.historyEntry),
                rejectionReason: null,
                history: appendOfferHistory(existing.history, 'SUBMITTED_FOR_APPROVAL', `Submitted for ${firstStage.label} approval`, req.auth.userId),
                updatedAt: new Date(),
            },
        });
        await logActivity({
            entityType: 'OFFER',
            entityId: row.id,
            action: 'SUBMITTED_FOR_APPROVAL',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: { stage: firstStage.label },
        });
        notifyOfferSubmittedForApproval(row);
        return res.json(mapOffer(row));
    }
    const record = buildOfferApprovalRecord('REQUESTED', req.auth, 'HR');
    const row = await prisma.offer.update({
        where: { id: req.params.id },
        data: {
            status: 'PENDING_HR_APPROVAL',
            approvalStep: 'HR',
            approval: JSON.stringify(record.approval),
            approvalHistory: appendApprovalHistory(existing.approvalHistory, record.historyEntry),
            rejectionReason: null,
            history: appendOfferHistory(existing.history, 'SUBMITTED_FOR_APPROVAL', 'Submitted for HR approval', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'SUBMITTED_FOR_APPROVAL',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
    });
    notifyOfferSubmittedForApproval(row);
    res.json(mapOffer(row));
});
router.post('/:id/approve-hr', requireRoles(...OFFER_HR_APPROVERS), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const opts = parseOfferApprovalBody(req.body);
    try {
        assertCanApproveOfferHr(req.auth, existing, opts);
    }
    catch (e) {
        return res.status(403).json({ error: e instanceof Error ? e.message : 'Not allowed' });
    }
    let comment;
    try {
        comment = assertApprovalCommentRequired(opts);
    }
    catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'Comment required' });
    }
    const nextStatus = nextStatusAfterHrApproval(existing);
    const record = buildOfferApprovalRecord('APPROVED', req.auth, 'HR', { ...opts, comment });
    const row = await prisma.offer.update({
        where: { id: req.params.id },
        data: {
            status: nextStatus,
            approvalStep: nextStatus === 'PENDING_EXEC_APPROVAL' ? 'EXEC' : null,
            approval: JSON.stringify(record.approval),
            approvalHistory: appendApprovalHistory(existing.approvalHistory, record.historyEntry),
            history: appendOfferHistory(existing.history, 'APPROVED', nextStatus === 'PENDING_EXEC_APPROVAL'
                ? `HR approved — pending executive approval. Comment: ${comment}`
                : `HR approved. Comment: ${comment}`, req.auth.userId),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'APPROVED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { step: 'HR', nextStatus },
    });
    if (nextStatus === 'PENDING_EXEC_APPROVAL') {
        notifyOfferPendingExecApproval(row);
    }
    else {
        notifyOfferApproved(row);
    }
    res.json(mapOffer(row));
});
router.post('/:id/approve-exec', requireRoles(...OFFER_EXEC_APPROVERS), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const opts = parseOfferApprovalBody(req.body);
    try {
        assertCanApproveOfferExec(req.auth, existing, opts);
    }
    catch (e) {
        return res.status(403).json({ error: e instanceof Error ? e.message : 'Not allowed' });
    }
    let comment;
    try {
        comment = assertApprovalCommentRequired(opts);
    }
    catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'Comment required' });
    }
    const record = buildOfferApprovalRecord('APPROVED', req.auth, 'EXEC', { ...opts, comment });
    const row = await prisma.offer.update({
        where: { id: req.params.id },
        data: {
            status: 'APPROVED',
            approvalStep: null,
            approval: JSON.stringify(record.approval),
            approvalHistory: appendApprovalHistory(existing.approvalHistory, record.historyEntry),
            history: appendOfferHistory(existing.history, 'APPROVED', `Executive approval granted. Comment: ${comment}`, req.auth.userId),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'APPROVED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { step: 'EXEC' },
    });
    notifyOfferApproved(row);
    res.json(mapOffer(row));
});
router.post('/:id/approve-stage', requireRoles(...INTERNAL_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
        assertCanApproveOfferStage(req.auth, existing);
    }
    catch (e) {
        if (e instanceof CandidateAccessError) {
            return res.status(403).json({ error: e.message });
        }
        return res.status(403).json({ error: e instanceof Error ? e.message : 'Not allowed' });
    }
    const opts = parseOfferApprovalBody(req.body);
    let comment;
    try {
        comment = assertApprovalCommentRequired(opts);
    }
    catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'Comment required' });
    }
    const stage = getCurrentStage(existing);
    const stageLabel = stage?.label ?? 'Approval';
    const record = buildOfferApprovalRecord('APPROVED', req.auth, stageLabel, { comment });
    const next = nextStatusAfterStageApproval(existing);
    const historyDescription = next.status === 'APPROVED'
        ? `${stageLabel} approved — offer fully approved. Comment: ${comment}`
        : `${stageLabel} approved — pending next stage. Comment: ${comment}`;
    const row = await prisma.offer.update({
        where: { id: req.params.id },
        data: {
            status: next.status,
            approvalStep: next.approvalStep,
            approval: JSON.stringify(record.approval),
            approvalHistory: appendApprovalHistory(existing.approvalHistory, record.historyEntry),
            history: appendOfferHistory(existing.history, 'APPROVED', historyDescription, req.auth.userId),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'APPROVED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { stage: stageLabel, nextStatus: next.status },
    });
    if (next.status === 'APPROVED') {
        notifyOfferApproved(row);
    }
    else {
        notifyOfferSubmittedForApproval(row);
    }
    res.json(mapOffer(row));
});
router.post('/:id/reject', requireRoles(...OFFER_HR_APPROVERS, ...OFFER_EXEC_APPROVERS, ...INTERNAL_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    const opts = parseOfferApprovalBody(req.body);
    if (existing.status === 'PENDING_APPROVAL' && usesApprovalChain(existing)) {
        try {
            await assertCanViewOffer(req.auth, existing.id);
            assertCanApproveOfferStage(req.auth, existing);
        }
        catch (e) {
            if (e instanceof CandidateAccessError) {
                return res.status(403).json({ error: e.message });
            }
            return res.status(403).json({ error: e instanceof Error ? e.message : 'Not allowed' });
        }
        const stage = getCurrentStage(existing);
        const stageLabel = stage?.label ?? 'Approval';
        const record = buildOfferApprovalRecord('REJECTED', req.auth, stageLabel, opts);
        const row = await prisma.offer.update({
            where: { id: req.params.id },
            data: {
                status: 'DRAFT',
                approvalStep: null,
                approval: JSON.stringify(record.approval),
                approvalHistory: appendApprovalHistory(existing.approvalHistory, record.historyEntry),
                rejectionReason: opts.reason ?? 'Rejected',
                history: appendOfferHistory(existing.history, 'REJECTED', opts.reason ?? `Rejected at ${stageLabel}`, req.auth.userId),
                updatedAt: new Date(),
            },
        });
        await logActivity({
            entityType: 'OFFER',
            entityId: row.id,
            action: 'REJECTED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: { stage: stageLabel, reason: opts.reason },
        });
        notifyOfferRejected(row);
        return res.json(mapOffer(row));
    }
    const step = existing.status === 'PENDING_EXEC_APPROVAL' ? 'EXEC' : 'HR';
    try {
        if (step === 'EXEC') {
            assertCanApproveOfferExec(req.auth, existing, opts);
        }
        else {
            assertCanApproveOfferHr(req.auth, existing, opts);
        }
    }
    catch (e) {
        return res.status(403).json({ error: e instanceof Error ? e.message : 'Not allowed' });
    }
    const record = buildOfferApprovalRecord('REJECTED', req.auth, step, opts);
    const row = await prisma.offer.update({
        where: { id: req.params.id },
        data: {
            status: 'DRAFT',
            approvalStep: null,
            approval: JSON.stringify(record.approval),
            approvalHistory: appendApprovalHistory(existing.approvalHistory, record.historyEntry),
            rejectionReason: opts.reason ?? 'Rejected',
            history: appendOfferHistory(existing.history, 'REJECTED', opts.reason ?? 'Offer rejected', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'REJECTED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { step, reason: opts.reason },
    });
    notifyOfferRejected(row);
    res.json(mapOffer(row));
});
router.post('/:id/rollback-approval', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    const target = getOfferApprovalRollbackTarget(existing);
    if (!target) {
        return res.status(400).json({ error: 'This offer cannot be rolled back further' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;
    const rollbackEntry = {
        action: 'ROLLED_BACK',
        fromStatus: existing.status,
        toStatus: target.status,
        by: req.auth.userId,
        at: new Date().toISOString(),
        role: req.auth.role,
        ...(reason ? { reason } : {}),
    };
    const data = {
        status: target.status,
        approvalStep: target.approvalStep,
        rejectionReason: null,
        approvalHistory: appendApprovalHistory(existing.approvalHistory, rollbackEntry),
        history: appendOfferHistory(existing.history, 'ROLLED_BACK', target.description, req.auth.userId),
        updatedAt: new Date(),
    };
    if (target.status === 'DRAFT') {
        data.approval = '{}';
    }
    else if (target.status !== 'APPROVED' && target.approvalStep) {
        const stepLabel = target.status === 'PENDING_APPROVAL'
            ? parseApprovalChainJson(existing.approvalChainJson).stages.find((s) => s.id === target.approvalStep)?.label ?? 'Approval'
            : target.approvalStep;
        const record = buildOfferApprovalRecord('REQUESTED', req.auth, stepLabel);
        data.approval = JSON.stringify(record.approval);
    }
    if (existing.status === 'SENT' && target.status === 'APPROVED') {
        data.sentAt = null;
        data.validUntil = null;
    }
    const row = await prisma.offer.update({
        where: { id: existing.id },
        data,
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'ROLLED_BACK',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: { fromStatus: existing.status, toStatus: target.status, reason },
    });
    res.json(mapOffer(row));
});
router.post('/:id/send', requireRoles(...OFFER_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    try {
        assertCanSendOffer(existing);
    }
    catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'Cannot send' });
    }
    const ctx = await loadOfferLetterContext(existing.id);
    if (!ctx)
        return res.status(404).json({ error: 'Not found' });
    const candidate = ctx.candidate;
    const portalAccount = await ensureCandidatePortalAccount({
        email: candidate.email,
        name: candidate.name,
        phone: candidate.phone,
    });
    if (!portalAccount.ok) {
        return res.status(400).json({ error: portalAccount.error });
    }
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 7);
    const row = await prisma.offer.update({
        where: { id: existing.id },
        data: {
            status: 'SENT',
            sentAt: new Date(),
            validUntil,
            letterHtml: ctx.letterHtml,
            history: appendOfferHistory(existing.history, 'SENT', 'Offer sent to candidate', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    const origin = env.clientOrigin.replace(/\/$/, '');
    const portalOfferPath = `/candidate/offers/${row.id}`;
    const portalLoginUrl = `${origin}/candidate/login?returnTo=${encodeURIComponent(portalOfferPath)}`;
    const emailResult = await sendOfferSentEmail({
        to: candidate.email,
        candidateName: candidate.name,
        annualCtc: ctx.annualCtc,
        portalOfferUrl: `${origin}${portalOfferPath}`,
        portalLoginUrl,
        portalPassword: portalAccount.password,
        accountCreated: portalAccount.created,
        validUntil: validUntil.toISOString(),
    });
    if (!emailResult.sent && emailResult.reason === 'not_configured') {
        logTemporaryPassword('Candidate portal (offer sent)', candidate.email, portalAccount.password);
    }
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'SENT',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {
            candidateId: candidate.id,
            candidateName: candidate.name,
            candidateEmail: candidate.email,
            portalAccountCreated: portalAccount.created,
            emailSent: emailResult.sent,
        },
    });
    if (portalAccount.created) {
        await logActivity({
            entityType: 'CANDIDATE',
            entityId: candidate.id,
            action: 'PORTAL_ACCOUNT_CREATED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: { name: candidate.name, via: 'offer_sent', offerId: row.id },
        });
    }
    if (row.requirementId)
        await syncRequirementHiringState(row.requirementId);
    res.json(mapOffer(row));
});
router.post('/:id/withdraw', requireRoles(...OFFER_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    if (!['APPROVED', 'SENT'].includes(existing.status)) {
        return res.status(400).json({ error: 'Only approved or sent offers can be withdrawn' });
    }
    const row = await prisma.offer.update({
        where: { id: existing.id },
        data: {
            status: 'WITHDRAWN',
            history: appendOfferHistory(existing.history, 'WITHDRAWN', 'Offer withdrawn', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'WITHDRAWN',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
    });
    res.json(mapOffer(row));
});
router.post('/:id/negotiate', requireRoles(...OFFER_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    if (existing.status !== 'SENT') {
        return res.status(400).json({ error: 'Only sent offers can enter negotiation' });
    }
    const row = await prisma.offer.update({
        where: { id: existing.id },
        data: {
            status: 'NEGOTIATION',
            history: appendOfferHistory(existing.history, 'NEGOTIATION_STARTED', 'Offer moved to negotiation', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'NEGOTIATION_STARTED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
    });
    res.json(mapOffer(row));
});
router.post('/:id/revise', requireRoles(...OFFER_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    if (existing.status !== 'NEGOTIATION') {
        return res.status(400).json({ error: 'Only offers in negotiation can be revised' });
    }
    const row = await prisma.offer.update({
        where: { id: existing.id },
        data: {
            status: 'DRAFT',
            approval: '{}',
            approvalStep: null,
            rejectionReason: null,
            history: appendOfferHistory(existing.history, 'REVISED', 'Offer revised — returned to draft', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    await logActivity({
        entityType: 'OFFER',
        entityId: row.id,
        action: 'REVISED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
    });
    res.json(mapOffer(row));
});
router.post('/:id/accept', requireRoles(...OFFER_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    if (existing.status !== 'SENT') {
        return res.status(400).json({ error: 'Only sent offers can be accepted' });
    }
    const row = await prisma.offer.update({
        where: { id: existing.id },
        data: {
            status: 'ACCEPTED',
            respondedAt: new Date(),
            respondedBy: req.auth.userId,
            history: appendOfferHistory(existing.history, 'ACCEPTED', 'Offer accepted by staff', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    notifyOfferStatusChange(row, 'ACCEPTED');
    {
        const cand = await prisma.candidate.findUnique({
            where: { id: row.candidateId },
            select: { id: true, name: true },
        });
        await logActivity({
            entityType: 'OFFER',
            entityId: row.id,
            action: 'ACCEPTED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: { candidateId: cand?.id, candidateName: cand?.name },
        });
    }
    if (row.requirementId)
        await syncRequirementHiringState(row.requirementId);
    res.json(mapOffer(row));
});
router.post('/:id/decline', requireRoles(...OFFER_ROLES), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    try {
        await assertCanViewOffer(req.auth, existing.id);
    }
    catch (err) {
        if (err instanceof CandidateAccessError) {
            return res.status(403).json({ error: err.message });
        }
        throw err;
    }
    if (existing.status !== 'SENT') {
        return res.status(400).json({ error: 'Only sent offers can be declined' });
    }
    const row = await prisma.offer.update({
        where: { id: existing.id },
        data: {
            status: 'DECLINED',
            respondedAt: new Date(),
            respondedBy: req.auth.userId,
            history: appendOfferHistory(existing.history, 'DECLINED', 'Offer declined by staff', req.auth.userId),
            updatedAt: new Date(),
        },
    });
    notifyOfferStatusChange(row, 'DECLINED');
    {
        const cand = await prisma.candidate.findUnique({
            where: { id: row.candidateId },
            select: { id: true, name: true },
        });
        await logActivity({
            entityType: 'OFFER',
            entityId: row.id,
            action: 'DECLINED',
            performedBy: req.auth.userId,
            performerRole: req.auth.role,
            details: { candidateId: cand?.id, candidateName: cand?.name },
        });
    }
    res.json(mapOffer(row));
});
router.delete('/:id', requireRoles('ADMIN'), async (req, res) => {
    const existing = await prisma.offer.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: 'Not found' });
    await prisma.offer.delete({ where: { id: req.params.id } });
    await logActivity({
        entityType: 'OFFER',
        entityId: existing.id,
        action: 'DELETED',
        performedBy: req.auth.userId,
        performerRole: req.auth.role,
        details: {
            candidateId: existing.candidateId,
            requirementId: existing.requirementId,
            status: existing.status,
        },
    });
    res.status(204).send();
});
export default router;
