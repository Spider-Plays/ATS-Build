const NAV_CATALOG = [
    {
        id: 'dashboard',
        title: 'Dashboard',
        href: '/',
        description: 'Home overview of recruiting activity.',
        keywords: ['home', 'dashboard', 'overview', 'start'],
    },
    {
        id: 'candidates',
        title: 'Candidates',
        href: '/candidates',
        description: 'Browse and manage candidates in your access scope.',
        keywords: ['candidate', 'applicants', 'talent', 'talent'],
    },
    {
        id: 'candidate-new',
        title: 'Add candidate',
        href: '/candidates/new',
        description: 'Create a new candidate profile.',
        keywords: ['add candidate', 'new candidate', 'create candidate'],
    },
    {
        id: 'candidate-search',
        title: 'Candidate search',
        href: '/candidate-search',
        description: 'Advanced candidate search and matching.',
        keywords: ['search candidates', 'find candidate', 'matching'],
    },
    {
        id: 'pipeline',
        title: 'Pipeline',
        href: '/pipeline',
        description: 'Kanban-style hiring pipeline by requirement.',
        keywords: ['pipeline', 'kanban', 'stages', 'funnel'],
    },
    {
        id: 'requirements',
        title: 'Requirements / jobs',
        href: '/requirements',
        description: 'Open and live job requirements.',
        keywords: ['requirement', 'job', 'role', 'opening', 'requisition'],
    },
    {
        id: 'requirement-new',
        title: 'New requirement',
        href: '/requirements/new',
        description: 'Create a new job requirement.',
        keywords: ['new job', 'create requirement', 'post job'],
    },
    {
        id: 'business-requirements',
        title: 'Business requirements / client deals',
        href: '/business-requirements',
        description: 'Pre-SOW client deals and business requirements.',
        keywords: ['business requirement', 'client deal', 'sow', 'account'],
    },
    {
        id: 'interviews',
        title: 'Interviews',
        href: '/interviews',
        description: 'Scheduled interviews and calendar view.',
        keywords: ['interview', 'schedule', 'calendar'],
    },
    {
        id: 'interviews-feedback',
        title: 'Interviews awaiting feedback',
        href: '/interviews?filter=feedback',
        description: 'Interviews that still need feedback submitted.',
        keywords: ['feedback', 'awaiting feedback', 'scorecard'],
    },
    {
        id: 'interviews-upcoming',
        title: 'Upcoming interviews',
        href: '/interviews?filter=upcoming',
        description: 'Future scheduled interviews.',
        keywords: ['upcoming interview', 'today interview'],
    },
    {
        id: 'offers',
        title: 'Offers',
        href: '/offers',
        description: 'Offer letters and approval queue.',
        keywords: ['offer', 'compensation', 'ctc', 'letter'],
    },
    {
        id: 'offers-pending',
        title: 'Offers pending approval',
        href: '/offers',
        description: 'Review offers waiting on HR or executive approval.',
        keywords: ['approve offer', 'pending offer', 'hr approval', 'exec approval'],
    },
    {
        id: 'vendors',
        title: 'Vendors',
        href: '/vendors',
        description: 'Staffing vendors and assignments.',
        keywords: ['vendor', 'agency', 'supplier'],
    },
    {
        id: 'change-requests',
        title: 'Change requests',
        href: '/self-service/change-requests',
        description: 'Request product/process changes; HR and admin review queue.',
        keywords: ['change request', 'ticket', 'self service', 'cr'],
    },
    {
        id: 'ta-process',
        title: 'TA Process',
        href: '/self-service/ta-process',
        description: 'Standard Talent Acquisition workflow from requisition to joining.',
        keywords: ['ta process', 'talent acquisition', 'hiring process', 'self service'],
    },
    {
        id: 'policies',
        title: 'Policies',
        href: '/self-service/policies',
        description: 'Employee referral, rehire, and campus hiring policies.',
        keywords: ['policy', 'erp', 'referral policy', 'rehire', 'campus hiring', 'self service'],
    },
    {
        id: 'training',
        title: 'Training',
        href: '/self-service/training',
        description: 'TA enablement and training modules for hiring stakeholders.',
        keywords: ['training', 'enablement', 'learning', 'self service'],
    },
    {
        id: 'reports-hiring',
        title: 'Hiring report',
        href: '/reports/hiring',
        description: 'Hiring metrics and funnel reporting.',
        keywords: ['report', 'hiring report', 'metrics', 'analytics'],
    },
    {
        id: 'reports-referrals',
        title: 'Referral report',
        href: '/reports/referrals',
        description: 'Employee referral program reporting.',
        keywords: ['referral report', 'referrals'],
    },
    {
        id: 'reports-vendors',
        title: 'Vendor report',
        href: '/reports/vendors',
        description: 'Vendor submission and performance reporting.',
        keywords: ['vendor report'],
    },
    {
        id: 'admin-users',
        title: 'User management',
        href: '/admin/users',
        description: 'Create and manage portal user accounts (admin).',
        keywords: ['users', 'accounts', 'invite', 'roles', 'portal users'],
        adminOnly: true,
    },
    {
        id: 'admin-departments',
        title: 'Departments catalog',
        href: '/admin/departments',
        description: 'Manage department dropdown values.',
        keywords: ['department', 'catalog'],
        adminOnly: true,
    },
    {
        id: 'admin-clients',
        title: 'Clients catalog',
        href: '/admin/clients',
        description: 'Manage client catalog entries.',
        keywords: ['client catalog', 'clients admin'],
        adminOnly: true,
    },
    {
        id: 'admin-skills',
        title: 'Skills catalog',
        href: '/admin/skills',
        description: 'Manage skills used on candidates and requirements.',
        keywords: ['skills', 'skill catalog'],
        adminOnly: true,
    },
    {
        id: 'admin-dropdowns',
        title: 'Dropdown settings',
        href: '/admin/dropdowns',
        description: 'Configure shared dropdown lists.',
        keywords: ['dropdown', 'settings', 'lists'],
        adminOnly: true,
    },
    {
        id: 'admin-role-access',
        title: 'Role page access',
        href: '/admin/role-access',
        description: 'Control which roles can open which pages (super admin).',
        keywords: ['role access', 'permissions', 'page access'],
        roles: ['SUPER_ADMIN'],
    },
    {
        id: 'admin-panels',
        title: 'Interview panels',
        href: '/admin/interview-panels',
        description: 'Configure interview panel levels and interviewers.',
        keywords: ['interview panel', 'panel level'],
        adminOnly: true,
    },
];
function roleCanSee(entry, role) {
    if (role === 'SUPER_ADMIN')
        return true;
    if (entry.roles?.length)
        return entry.roles.includes(role);
    if (entry.adminOnly)
        return role === 'ADMIN' || role === 'SUPER_ADMIN';
    return true;
}
export function searchNavCatalog(role, query) {
    const visible = NAV_CATALOG.filter((e) => roleCanSee(e, role));
    const q = (query || '').toLowerCase().trim();
    if (!q)
        return visible.slice(0, 12);
    const scored = visible
        .map((entry) => {
        let score = 0;
        const hay = `${entry.title} ${entry.description} ${entry.keywords.join(' ')}`.toLowerCase();
        if (hay.includes(q))
            score += 5;
        for (const word of q.split(/\s+/)) {
            if (word.length < 2)
                continue;
            if (hay.includes(word))
                score += 2;
            if (entry.keywords.some((k) => k.includes(word)))
                score += 3;
        }
        return { entry, score };
    })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);
    return (scored.length ? scored.map((r) => r.entry) : visible.slice(0, 8)).slice(0, 10);
}
