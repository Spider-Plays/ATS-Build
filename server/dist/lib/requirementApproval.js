export const HR_HEAD_DELEGATE = 'HR_HEAD';
export function parseRequirementApprovalBody(body) {
    if (!body || typeof body !== 'object')
        return {};
    const o = body;
    const comments = typeof o.comments === 'string' ? o.comments.trim() : undefined;
    return {
        onBehalfOfHrHead: o.onBehalfOfHrHead === true,
        comments: comments || undefined,
    };
}
export function requireApprovalComments(comments) {
    const text = comments?.trim();
    if (!text) {
        throw new Error('A comment is required when approving or rejecting a requirement');
    }
    return text;
}
export function buildApprovalRecord(decision, auth, onBehalfOfHrHead, comments) {
    const timestamp = new Date().toISOString();
    const onBehalf = auth.role === 'ADMIN' && onBehalfOfHrHead ? HR_HEAD_DELEGATE : undefined;
    return {
        timestamp,
        historyEntry: {
            action: decision,
            by: auth.userId,
            at: timestamp,
            role: auth.role,
            comments,
            ...(onBehalf ? { onBehalfOf: onBehalf } : {}),
        },
        approval: {
            decision,
            decidedBy: auth.userId,
            decidedAt: timestamp,
            comments,
            ...(onBehalf ? { onBehalfOf: onBehalf, performedByRole: auth.role } : {}),
        },
    };
}
