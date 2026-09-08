/** Modules employees can select when submitting a change request. */
export const CHANGE_REQUEST_MODULES = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'business_requirements', label: 'Business Requirements' },
    { key: 'requirements', label: 'Requirements' },
    { key: 'reports', label: 'Reports' },
    { key: 'vendors', label: 'Vendors' },
    { key: 'candidate_search', label: 'Candidate Search' },
    { key: 'candidates', label: 'Candidates' },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'interviews', label: 'Interviews' },
    { key: 'offers', label: 'Offers' },
    { key: 'offer_compensation_config', label: 'Salary Breakdown' },
    { key: 'offer_letter_template', label: 'Offer Letter Template' },
    { key: 'admin', label: 'Administration' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'settings', label: 'Settings' },
    { key: 'referral_portal', label: 'Employee Referral Portal' },
    { key: 'vendor_portal', label: 'Vendor Portal' },
    { key: 'candidate_portal', label: 'Candidate Portal' },
    { key: 'other', label: 'Other' },
];
export function moduleLabel(key) {
    return CHANGE_REQUEST_MODULES.find((m) => m.key === key)?.label ?? key;
}
