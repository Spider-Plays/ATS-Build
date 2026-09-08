export const OFFER_STATUSES = [
    'DRAFT',
    'PENDING_HR_APPROVAL',
    'PENDING_EXEC_APPROVAL',
    'PENDING_APPROVAL',
    'APPROVED',
    'SENT',
    'NEGOTIATION',
    'ACCEPTED',
    'DECLINED',
    'WITHDRAWN',
];
const ALLOWED = {
    DRAFT: ['PENDING_HR_APPROVAL', 'PENDING_APPROVAL'],
    PENDING_HR_APPROVAL: ['DRAFT', 'APPROVED', 'PENDING_EXEC_APPROVAL'],
    PENDING_EXEC_APPROVAL: ['DRAFT', 'APPROVED'],
    PENDING_APPROVAL: ['DRAFT', 'APPROVED', 'PENDING_APPROVAL'],
    APPROVED: ['SENT', 'WITHDRAWN'],
    SENT: ['ACCEPTED', 'DECLINED', 'NEGOTIATION', 'WITHDRAWN'],
    NEGOTIATION: ['DRAFT'],
    ACCEPTED: [],
    DECLINED: [],
    WITHDRAWN: [],
};
export function assertOfferTransition(from, to) {
    const allowed = ALLOWED[from];
    if (!allowed || !allowed.includes(to)) {
        throw new Error(`Cannot transition offer from ${from} to ${to}`);
    }
}
export const OFFER_DETAIL_EDITOR_ROLES = ['SUPER_ADMIN', 'HR_HEAD', 'HR_MANAGER'];
const HR_EDITABLE_STATUSES = [
    'DRAFT',
    'NEGOTIATION',
    'PENDING_HR_APPROVAL',
    'PENDING_EXEC_APPROVAL',
    'PENDING_APPROVAL',
];
export function canEditOfferFields(status) {
    return status === 'DRAFT' || status === 'NEGOTIATION';
}
export function canEditOfferDetails(role, status) {
    if (OFFER_DETAIL_EDITOR_ROLES.includes(role)) {
        return HR_EDITABLE_STATUSES.includes(status);
    }
    return canEditOfferFields(status);
}
