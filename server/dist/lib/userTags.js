/** Feature tags assigned per user (stored in User.permissions JSON column). */
export const FEATURE_TAG_KEYS = [
    'careers',
    'employee_referral',
    'vendor_submission',
    'mis',
    'market_data',
];
export const FEATURE_TAG_DEFINITIONS = [
    {
        key: 'careers',
        label: 'Careers',
        description: 'Candidate portal and self-applied profiles.',
        path: '/features/careers',
        icon: 'work',
    },
    {
        key: 'employee_referral',
        label: 'Employee referral',
        description: 'Internal employee referrals (ERP).',
        path: '/features/employee-referral',
        icon: 'group_add',
    },
    {
        key: 'vendor_submission',
        label: 'Vendor submission',
        description: 'Candidate profiles submitted by staffing vendors.',
        path: '/features/vendor-submission',
        icon: 'storefront',
    },
    {
        key: 'mis',
        label: 'MIS',
        description: 'MIS dashboard and recruitment module links.',
        path: '/features/mis',
        icon: 'analytics',
    },
    {
        key: 'market_data',
        label: 'Market Data',
        description: 'Edit Skill Pay Analyzer CRISTO market data and location multipliers.',
        path: '/market-trends',
        icon: 'trending_up',
    },
];
export function parseFeatureTags(raw) {
    try {
        const arr = JSON.parse(raw || '[]');
        if (!Array.isArray(arr))
            return [];
        return arr.filter((t) => FEATURE_TAG_KEYS.includes(t));
    }
    catch {
        return [];
    }
}
export function sanitizeFeatureTags(tags) {
    return [...new Set(tags.filter((t) => FEATURE_TAG_KEYS.includes(t)))];
}
export function hasFeatureTag(role, userTags, tag) {
    if (role === 'ADMIN' || role === 'SUPER_ADMIN')
        return true;
    return (userTags ?? []).includes(tag);
}
export function featureTagFromPath(pathname) {
    if (pathname.startsWith('/features/careers'))
        return 'careers';
    if (pathname.startsWith('/features/employee-referral'))
        return 'employee_referral';
    if (pathname.startsWith('/features/vendor-submission'))
        return 'vendor_submission';
    if (pathname.startsWith('/features/mis'))
        return 'mis';
    return null;
}
