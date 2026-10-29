import { env } from '../config/env.js';
import { getAnnualCtcFromOffer } from './offerCompensation.js';
import { canUserApproveCurrentStage, getCurrentStage, usesApprovalChain, } from './offerApprovalChain.js';
import { canEditOfferDetails } from './offerTransitions.js';
export const OFFER_HR_APPROVAL_ROLES = [];
export const OFFER_EXEC_APPROVAL_ROLES = [];
export function requiresExecApproval(annualCtc) {
    return annualCtc >= env.offerExecApprovalThreshold;
}
export function nextStatusAfterHrApproval(offer) {
    const ctc = getAnnualCtcFromOffer(offer);
    return requiresExecApproval(ctc) ? 'PENDING_EXEC_APPROVAL' : 'APPROVED';
}
export function assertCanSubmitOffer(auth, offer) {
    if (offer.status !== 'DRAFT' && offer.status !== 'NEGOTIATION') {
        throw new Error('Only draft or negotiation offers can be submitted');
    }
}
export function assertCanApproveOfferHr(auth, offer, options = {}) {
    if (offer.status !== 'PENDING_HR_APPROVAL') {
        throw new Error('Offer is not pending HR approval');
    }
    // Offers are approved only by users assigned in the approval chain; no role may act on the
    // retired fixed HR step. Roll the offer back to draft and resubmit it with assigned approvers.
    throw new Error(LEGACY_STEP_MESSAGE);
}
const LEGACY_STEP_MESSAGE = 'This offer uses the retired role-based approval flow. Roll it back to draft and resubmit it with assigned approvers.';
export function assertCanApproveOfferExec(auth, offer, options = {}) {
    if (offer.status !== 'PENDING_EXEC_APPROVAL') {
        throw new Error('Offer is not pending executive approval');
    }
    throw new Error(LEGACY_STEP_MESSAGE);
}
export function assertCanSendOffer(offer) {
    if (offer.status !== 'APPROVED') {
        throw new Error('Only approved offers can be sent');
    }
}
export function assertCanRespondToOffer(offer) {
    if (offer.status !== 'SENT') {
        throw new Error('Offer is not available for response');
    }
    if (offer.validUntil && offer.validUntil < new Date()) {
        throw new Error('This offer has expired');
    }
}
export function assertCanEditOffer(auth, offer) {
    if (!canEditOfferDetails(auth.role, offer.status)) {
        throw new Error('You cannot edit this offer at its current stage');
    }
}
export function assertCanApproveOfferStage(auth, offer) {
    if (offer.status !== 'PENDING_APPROVAL') {
        throw new Error('Offer is not pending approval');
    }
    if (!usesApprovalChain(offer)) {
        throw new Error('This offer does not use a custom approval chain');
    }
    if (!canUserApproveCurrentStage(auth, offer)) {
        const stage = getCurrentStage(offer);
        throw new Error(stage
            ? `Only assigned approvers for ${stage.label} can act at this step`
            : 'You are not allowed to approve at this step');
    }
}
export function assertCanRejectOfferStage(auth, offer) {
    if (offer.status === 'PENDING_APPROVAL' && usesApprovalChain(offer)) {
        assertCanApproveOfferStage(auth, offer);
        return;
    }
    throw new Error('Use HR or executive rejection for this offer');
}
