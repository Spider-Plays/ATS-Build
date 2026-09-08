export const CAREERS_CANDIDATE_WHERE = {
    source: 'Candidate Portal',
};
export const ERP_CANDIDATE_WHERE = {
    OR: [
        { referredByUserId: { not: null } },
        { source: { startsWith: 'Employee Referral' } },
    ],
};
export const VENDOR_SUBMISSION_CANDIDATE_WHERE = {
    OR: [{ vendorId: { not: null } }, { source: { startsWith: 'Vendor:' } }],
};
