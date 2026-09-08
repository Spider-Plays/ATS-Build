export const HR_HEAD_DELEGATE = 'HR_HEAD';
export const EXEC_DELEGATE = 'EXEC';
export function parseOfferApprovalBody(body) {
    if (!body || typeof body !== 'object')
        return {};
    const o = body;
    return {
        onBehalfOfHrHead: o.onBehalfOfHrHead === true,
        onBehalfOfExec: o.onBehalfOfExec === true,
        reason: typeof o.reason === 'string' ? o.reason : undefined,
        comment: typeof o.comment === 'string' ? o.comment : undefined,
    };
}
export function assertApprovalCommentRequired(opts) {
    const comment = opts.comment?.trim();
    if (!comment) {
        throw new Error('A comment is required to approve this offer');
    }
    return comment;
}
export function buildOfferApprovalRecord(decision, auth, step, options = {}) {
    const timestamp = new Date().toISOString();
    const onBehalf = auth.role === 'ADMIN' && options.onBehalfOfHrHead && step === 'HR'
        ? HR_HEAD_DELEGATE
        : auth.role === 'ADMIN' && options.onBehalfOfExec && step === 'EXEC'
            ? EXEC_DELEGATE
            : undefined;
    const comment = options.comment?.trim();
    return {
        timestamp,
        historyEntry: {
            action: decision,
            step,
            by: auth.userId,
            at: timestamp,
            role: auth.role,
            ...(onBehalf ? { onBehalfOf: onBehalf } : {}),
            ...(options.reason ? { reason: options.reason } : {}),
            ...(comment ? { comment } : {}),
        },
        approval: {
            decision,
            step,
            decidedBy: auth.userId,
            decidedAt: timestamp,
            ...(onBehalf ? { onBehalfOf: onBehalf, performedByRole: auth.role } : {}),
            ...(options.reason ? { reason: options.reason } : {}),
            ...(comment ? { comment } : {}),
        },
    };
}
