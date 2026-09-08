import { getAnnualCtcFromOffer } from './offerCompensation.js';
import { requiresExecApproval } from './offerPermissions.js';
import { getCurrentStageIndex, parseApprovalChainJson, usesApprovalChain, } from './offerApprovalChain.js';
function parseApprovalHistory(raw) {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function hadExecApproval(history) {
    return history.some((entry) => entry.action === 'APPROVED' && entry.step === 'EXEC');
}
export function getOfferApprovalRollbackTarget(offer) {
    const history = parseApprovalHistory(offer.approvalHistory);
    if (offer.status === 'PENDING_APPROVAL' && usesApprovalChain(offer)) {
        const chain = parseApprovalChainJson(offer.approvalChainJson);
        const idx = getCurrentStageIndex(offer);
        if (idx > 0) {
            const prev = chain.stages[idx - 1];
            return {
                status: 'PENDING_APPROVAL',
                approvalStep: prev?.id ?? null,
                description: `Rolled back to ${prev?.label ?? 'previous stage'}`,
            };
        }
        return {
            status: 'DRAFT',
            approvalStep: null,
            description: 'Rolled back to draft before approval',
        };
    }
    switch (offer.status) {
        case 'PENDING_HR_APPROVAL':
            return {
                status: 'DRAFT',
                approvalStep: null,
                description: 'Rolled back to draft before HR approval',
            };
        case 'PENDING_EXEC_APPROVAL':
            return {
                status: 'PENDING_HR_APPROVAL',
                approvalStep: 'HR',
                description: 'Rolled back to HR approval',
            };
        case 'APPROVED':
            if (usesApprovalChain(offer)) {
                const chain = parseApprovalChainJson(offer.approvalChainJson);
                const last = chain.stages[chain.stages.length - 1];
                if (chain.stages.length > 1) {
                    const prev = chain.stages[chain.stages.length - 2];
                    return {
                        status: 'PENDING_APPROVAL',
                        approvalStep: prev?.id ?? last?.id ?? null,
                        description: `Rolled back to ${prev?.label ?? 'previous stage'}`,
                    };
                }
                return {
                    status: 'PENDING_APPROVAL',
                    approvalStep: last?.id ?? null,
                    description: `Rolled back to ${last?.label ?? 'approval'}`,
                };
            }
            if (hadExecApproval(history) || requiresExecApproval(getAnnualCtcFromOffer(offer))) {
                return {
                    status: 'PENDING_EXEC_APPROVAL',
                    approvalStep: 'EXEC',
                    description: 'Rolled back to executive approval',
                };
            }
            return {
                status: 'PENDING_HR_APPROVAL',
                approvalStep: 'HR',
                description: 'Rolled back to HR approval',
            };
        case 'SENT':
            return {
                status: 'APPROVED',
                approvalStep: null,
                description: 'Rolled back to approved (offer unsent)',
            };
        default:
            return null;
    }
}
export function canRollbackOfferApproval(status) {
    return getOfferApprovalRollbackTarget({ status }) != null;
}
