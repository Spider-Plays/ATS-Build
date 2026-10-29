import { prisma } from './prisma.js';
/** Internal staff roles configurable in User Management → Role access */
export const CONFIGURABLE_ROLES = [
    'ADMIN',
    'HR_HEAD',
    'TA_MANAGER',
    'HUMAN_RESOURCE',
    'FINANCE_HEAD',
    'RECRUITER',
    'TEAM_LEAD',
    'HIRING_MANAGER',
    'ACCOUNT_MANAGER',
    'INTERVIEWER',
];
export const PAGE_KEYS = [
    'dashboard',
    'business_requirements',
    'requirements',
    'reports',
    'vendors',
    'candidate_search',
    'candidates',
    'market_trends',
    'pipeline',
    'interviews',
    'offers',
    'offer_compensation_config',
    'offer_letter_template',
    'self_service',
    'ta_process',
    'policies',
    'training',
    'mis',
    'admin_users',
    'notifications',
    'settings',
];
export const PAGE_DEFINITIONS = [
    { key: 'dashboard', label: 'Dashboard', description: 'Home dashboard and overview' },
    {
        key: 'business_requirements',
        label: 'Business Requirements',
        description: 'Pre-hiring client discussions and deal stages',
    },
    { key: 'requirements', label: 'Requirements', description: 'Job requirements list and detail' },
    { key: 'reports', label: 'Reports', description: 'Hiring, employee referral, and vendor reports' },
    { key: 'vendors', label: 'Vendors', description: 'Vendor management' },
    { key: 'candidate_search', label: 'Candidate Search', description: 'Advanced candidate discovery and search' },
    { key: 'candidates', label: 'Candidates', description: 'Candidate profiles and add candidate' },
    { key: 'market_trends', label: 'Market Trends', description: 'Skill pay analyzer and forecasted market CTC' },
    { key: 'pipeline', label: 'Pipeline', description: 'Hiring pipeline by requirement' },
    { key: 'interviews', label: 'Interviews', description: 'Schedule and manage interviews' },
    { key: 'offers', label: 'Offers', description: 'Offer letters and approvals' },
    {
        key: 'offer_compensation_config',
        label: 'Salary Breakdown',
        description: 'CTC component percentages and allowances',
    },
    {
        key: 'offer_letter_template',
        label: 'Offer Letter Template',
        description: 'Offer letter wording and employment clauses',
    },
    {
        key: 'self_service',
        label: 'Self Service',
        description: 'Employee self-service portal and change requests',
    },
    {
        key: 'ta_process',
        label: 'TA Process',
        description: 'Coming soon. Talent acquisition process guide.',
    },
    {
        key: 'policies',
        label: 'Policies',
        description: 'Coming soon. Company policy library.',
    },
    {
        key: 'training',
        label: 'Training',
        description: 'Coming soon. Training materials.',
    },
    {
        key: 'mis',
        label: 'MIS',
        description: 'Coming soon. MIS dashboard.',
    },
    { key: 'admin_users', label: 'User Management', description: 'Admin user administration' },
    { key: 'notifications', label: 'Notifications', description: 'In-app notifications' },
    { key: 'settings', label: 'Settings', description: 'Account and app settings' },
];
/** Default page access (matches original sidebar / route behavior) */
export const DEFAULT_ROLE_PAGES = {
    ADMIN: [...PAGE_KEYS],
    HR_HEAD: [
        'dashboard',
        'requirements',
        'reports',
        'market_trends',
        'vendors',
        'candidate_search',
        'candidates',
        'pipeline',
        'interviews',
        'offers',
        'offer_letter_template',
        'self_service',
        'ta_process',
        'policies',
        'training',
        'notifications',
        'settings',
    ],
    TA_MANAGER: [
        'dashboard',
        'requirements',
        'reports',
        'market_trends',
        'vendors',
        'candidate_search',
        'candidates',
        'pipeline',
        'interviews',
        'offers',
        'self_service',
        'ta_process',
        'policies',
        'training',
        'notifications',
        'settings',
    ],
    HUMAN_RESOURCE: [
        'dashboard',
        'offers',
        'offer_compensation_config',
        'offer_letter_template',
        'self_service',
    ],
    RECRUITER: [
        'dashboard',
        'requirements',
        'reports',
        'vendors',
        'candidate_search',
        'candidates',
        'pipeline',
        'interviews',
        'offers',
        'self_service',
        'ta_process',
        'policies',
        'training',
        'notifications',
        'settings',
    ],
    TEAM_LEAD: [
        'dashboard',
        'requirements',
        'reports',
        'vendors',
        'candidate_search',
        'candidates',
        'pipeline',
        'interviews',
        'offers',
        'self_service',
        'notifications',
        'settings',
    ],
    HIRING_MANAGER: ['dashboard', 'business_requirements', 'requirements', 'reports', 'market_trends', 'self_service', 'notifications', 'settings'],
    ACCOUNT_MANAGER: ['dashboard', 'business_requirements', 'requirements', 'reports', 'market_trends', 'self_service', 'notifications', 'settings'],
    INTERVIEWER: ['dashboard', 'interviews', 'self_service', 'notifications', 'settings'],
    FINANCE_HEAD: ['dashboard', 'offer_compensation_config', 'self_service', 'notifications', 'settings'],
};
const UNDER_CONSTRUCTION_PAGE_KEYS = ['ta_process', 'policies', 'training', 'mis'];
/** Rows saved before these pages existed do not list them. Grant the role default until one is stored. */
function includeUnconfiguredUnderConstructionPages(role, pages) {
    if (UNDER_CONSTRUCTION_PAGE_KEYS.some((key) => pages.includes(key)))
        return pages;
    const extras = defaultPagesForRole(role).filter((key) => UNDER_CONSTRUCTION_PAGE_KEYS.includes(key));
    return [...new Set([...pages, ...extras])];
}
function parsePages(raw) {
    try {
        const arr = JSON.parse(raw || '[]');
        if (!Array.isArray(arr))
            return [];
        return arr.filter((p) => PAGE_KEYS.includes(p));
    }
    catch {
        return [];
    }
}
export function sanitizePages(pages) {
    const unique = [...new Set(pages.filter((p) => PAGE_KEYS.includes(p)))];
    return unique;
}
export function defaultPagesForRole(role) {
    if (role in DEFAULT_ROLE_PAGES) {
        return [...DEFAULT_ROLE_PAGES[role]];
    }
    return ['dashboard', 'notifications', 'settings'];
}
export function sanitizePagesForRole(role, pages) {
    let result = sanitizePages(pages);
    if (role !== 'ADMIN') {
        result = result.filter((p) => p !== 'admin_users');
    }
    if (role === 'INTERVIEWER') {
        result = result.filter((p) => p !== 'candidates');
    }
    return result;
}
export async function getAllowedPagesForRole(role) {
    const pages = await pagesAssignedToRole(role);
    const { filterPublishedPages } = await import('./pagePublication.js');
    return filterPublishedPages(role, pages);
}
async function pagesAssignedToRole(role) {
    if (role === 'DEVELOPER') {
        return [...PAGE_KEYS];
    }
    if (role === 'ADMIN') {
        const row = await prisma.rolePageAccess.findUnique({ where: { role } });
        if (!row)
            return [...PAGE_KEYS];
        const parsed = parsePages(row.pages);
        const pages = parsed.length > 0 ? sanitizePagesForRole(role, parsed) : [...PAGE_KEYS];
        return includeUnconfiguredUnderConstructionPages(role, pages);
    }
    if (role === 'CANDIDATE' || role === 'VENDOR' || role === 'EMPLOYEE') {
        return [];
    }
    const row = await prisma.rolePageAccess.findUnique({ where: { role } });
    const defaults = defaultPagesForRole(role);
    let pages;
    if (row) {
        const parsed = parsePages(row.pages);
        pages = parsed.length > 0 ? parsed : defaults;
    }
    else {
        pages = defaults;
    }
    return includeUnconfiguredUnderConstructionPages(role, sanitizePagesForRole(role, pages));
}
export async function getAllRolePageAccess() {
    const rows = await prisma.rolePageAccess.findMany();
    const byRole = new Map(rows.map((r) => [r.role, r]));
    const result = {};
    for (const role of CONFIGURABLE_ROLES) {
        const row = byRole.get(role);
        const raw = row?.pages ? parsePages(row.pages) : defaultPagesForRole(role);
        result[role] = {
            pages: includeUnconfiguredUnderConstructionPages(role, sanitizePagesForRole(role, raw)),
            updatedAt: row?.updatedAt.toISOString(),
        };
    }
    return result;
}
export async function setRolePageAccess(role, pages) {
    if (role === 'DEVELOPER') {
        return [...PAGE_KEYS];
    }
    let sanitized = sanitizePages(pages);
    if (role !== 'ADMIN') {
        sanitized = sanitized.filter((p) => p !== 'admin_users');
    }
    if (role === 'INTERVIEWER') {
        sanitized = sanitized.filter((p) => p !== 'candidates');
    }
    if (sanitized.length === 0) {
        throw new Error('At least one page must be enabled');
    }
    await prisma.rolePageAccess.upsert({
        where: { role },
        create: { role, pages: JSON.stringify(sanitized) },
        update: { pages: JSON.stringify(sanitized) },
    });
    return sanitizePagesForRole(role, sanitized);
}
export function pathnameToPageKey(pathname) {
    if (pathname === '/' || pathname.startsWith('/dashboard'))
        return 'dashboard';
    if (pathname.startsWith('/business-requirements'))
        return 'business_requirements';
    if (pathname.startsWith('/requirements'))
        return 'requirements';
    if (pathname.startsWith('/reports'))
        return 'reports';
    if (pathname.startsWith('/vendors'))
        return 'vendors';
    if (pathname.startsWith('/candidate-search'))
        return 'candidate_search';
    if (pathname.startsWith('/candidates'))
        return 'candidates';
    if (pathname.startsWith('/market-trends'))
        return 'market_trends';
    if (pathname.startsWith('/pipeline'))
        return 'pipeline';
    if (pathname.startsWith('/interviews'))
        return 'interviews';
    if (pathname.startsWith('/offers/compensation-config'))
        return 'offer_compensation_config';
    if (pathname.startsWith('/offers/letter-template'))
        return 'offer_letter_template';
    if (pathname.startsWith('/offers'))
        return 'offers';
    if (pathname.startsWith('/self-service/ta-process'))
        return 'ta_process';
    if (pathname.startsWith('/self-service/policies'))
        return 'policies';
    if (pathname.startsWith('/self-service/training'))
        return 'training';
    if (pathname.startsWith('/features/mis'))
        return 'mis';
    if (pathname.startsWith('/self-service'))
        return 'self_service';
    if (pathname.startsWith('/admin/users'))
        return 'admin_users';
    if (pathname.startsWith('/admin'))
        return null;
    if (pathname.startsWith('/notifications'))
        return 'notifications';
    if (pathname.startsWith('/settings'))
        return 'settings';
    return null;
}
