import { prisma } from './prisma.js';
export const EMAIL_TOGGLE_KEYS = [
    'invite',
    'vendorInvite',
    'adminPasswordReset',
    'passwordReset',
    'interviewScheduled',
    'interviewUpdated',
    'interviewCancelled',
    'interviewReminder',
    'interviewerAssigned',
    'offerSent',
    'offerAccepted',
    'offerDeclined',
    'candidateStatus',
    'jobDescription',
    'referralSubmitted',
    'referralStatus',
    'newCandidate',
    'vendorAssignment',
    'vendorCreationRequest',
    'vendorCreationApproved',
    'vendorCreationRejected',
    'vendorOnboardingSubmitted',
    'vendorOnboardingHrReview',
    'vendorOnboardingApproved',
    'vendorOnboardingRevision',
    'offerPendingHr',
    'offerPendingExecutive',
    'offerApprovedStaff',
    'offerRejectedStaff',
    'candidateStatusStaff',
    'requirementAfterSow',
    'businessRequirementStage',
    'requirementAging',
    'openRequisitionReport',
    'm365Test',
];
export const EMAIL_TOGGLE_LABELS = {
    invite: 'User invite',
    vendorInvite: 'Vendor invite',
    adminPasswordReset: 'Admin password reset',
    passwordReset: 'Password reset link',
    interviewScheduled: 'Interview scheduled',
    interviewUpdated: 'Interview updated',
    interviewCancelled: 'Interview cancelled',
    interviewReminder: 'Interview reminder',
    interviewerAssigned: 'Interviewer assigned',
    offerSent: 'Offer sent',
    offerAccepted: 'Offer accepted',
    offerDeclined: 'Offer declined',
    candidateStatus: 'Candidate status update',
    jobDescription: 'Job description',
    referralSubmitted: 'Referral submitted',
    referralStatus: 'Referral status',
    newCandidate: 'New candidate notification',
    vendorAssignment: 'Vendor job assignment',
    vendorCreationRequest: 'New vendor request',
    vendorCreationApproved: 'Vendor request approved',
    vendorCreationRejected: 'Vendor request rejected',
    vendorOnboardingSubmitted: 'Vendor onboarding submitted',
    vendorOnboardingHrReview: 'Vendor onboarding ready for HR review',
    vendorOnboardingApproved: 'Vendor onboarding approved',
    vendorOnboardingRevision: 'Vendor onboarding needs revision',
    offerPendingHr: 'Offer pending HR approval',
    offerPendingExecutive: 'Offer pending executive approval',
    offerApprovedStaff: 'Offer approved (staff)',
    offerRejectedStaff: 'Offer rejected (staff)',
    candidateStatusStaff: 'Candidate status updated (staff)',
    requirementAfterSow: 'New requirement after SOW',
    businessRequirementStage: 'Business requirement stage',
    requirementAging: 'Requirement aging alert',
    openRequisitionReport: 'Open requisition report',
    m365Test: 'Microsoft 365 connection test',
};
export const DEFAULT_EMAIL_TOGGLES = Object.fromEntries(EMAIL_TOGGLE_KEYS.map((key) => [key, true]));
const SETTING_KEY = 'email_toggles';
export async function getEmailToggles() {
    const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!setting)
        return { ...DEFAULT_EMAIL_TOGGLES };
    try {
        const stored = JSON.parse(setting.value);
        return {
            ...DEFAULT_EMAIL_TOGGLES,
            ...Object.fromEntries(EMAIL_TOGGLE_KEYS.filter((key) => typeof stored[key] === 'boolean').map((key) => [key, stored[key]])),
        };
    }
    catch {
        return { ...DEFAULT_EMAIL_TOGGLES };
    }
}
export async function isEmailKindEnabled(kind) {
    const toggles = await getEmailToggles();
    return toggles[kind] !== false;
}
export async function saveEmailToggles(flags, updatedBy) {
    const current = await getEmailToggles();
    const next = {
        ...current,
        ...Object.fromEntries(EMAIL_TOGGLE_KEYS.filter((key) => typeof flags[key] === 'boolean').map((key) => [key, flags[key]])),
    };
    await prisma.appSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: JSON.stringify(next), updatedBy },
        update: { value: JSON.stringify(next), updatedBy },
    });
    return next;
}
