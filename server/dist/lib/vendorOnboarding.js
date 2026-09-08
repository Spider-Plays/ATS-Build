/** Vendor onboarding + evaluation form definitions and scoring (Excel: Vendor Evaluation Form Process). */
export const VENDOR_ONBOARDING_STATUSES = [
    'NOT_STARTED',
    'ONBOARDING',
    'EVALUATION',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
];
export const VENDOR_CATEGORIES = [
    'PREFERRED',
    'APPROVED',
    'CONDITIONAL',
    'NOT_RECOMMENDED',
];
export const VENDOR_CATEGORY_LABELS = {
    PREFERRED: 'Preferred Vendor',
    APPROVED: 'Approved Vendor',
    CONDITIONAL: 'Conditional / Improvement Required',
    NOT_RECOMMENDED: 'Not Recommended',
};
export const EVALUATION_PARAMETERS = [
    {
        id: 'domain_technical',
        name: 'Domain & Technical Capability',
        description: 'Relevant skills, certifications, domain expertise',
        weight: 15,
    },
    {
        id: 'service_delivery',
        name: 'Service Delivery Quality',
        description: 'Quality of delivery, defect rates, SLAs',
        weight: 15,
    },
    {
        id: 'experience_track',
        name: 'Experience & Track Record',
        description: 'Years of experience, similar projects',
        weight: 10,
    },
    {
        id: 'resource_scalability',
        name: 'Resource Strength & Scalability',
        description: 'Availability, bench strength, ramp-up ability',
        weight: 10,
    },
    {
        id: 'commercials',
        name: 'Commercials & Pricing',
        description: 'Cost competitiveness, pricing transparency',
        weight: 15,
    },
    {
        id: 'compliance',
        name: 'Compliance & Governance',
        description: 'Legal, statutory, data security, NDAs',
        weight: 10,
    },
    {
        id: 'client_references',
        name: 'Client References',
        description: 'Feedback, references, case studies',
        weight: 10,
    },
    {
        id: 'innovation',
        name: 'Innovation & Value Add',
        description: 'Automation, process improvement, tools',
        weight: 5,
    },
    {
        id: 'communication',
        name: 'Communication & Responsiveness',
        description: 'Turnaround time, escalation handling',
        weight: 5,
    },
    {
        id: 'risk_dependency',
        name: 'Risk & Dependency',
        description: 'Business continuity, dependency risk',
        weight: 5,
    },
];
export function emptyOnboardingForm() {
    return {
        legalName: '',
        registeredAddress: '',
        primaryContactName: '',
        designation: '',
        email: '',
        contactNumber: '',
        website: '',
        yearOfIncorporation: '',
        totalEmployees: '',
        primaryServiceOfferings: '',
        coreServiceCapabilities: '',
        domainIndustryExperience: '',
        certifications: '',
        deliveryModel: '',
        qualityAssuranceProcesses: '',
        slaKpiManagement: '',
        escalationGovernance: '',
        automationTools: '',
        averageTeamSize: '',
        skillAvailabilityBench: '',
        pricingModelFulltime: '',
        pricingModelContract: '',
        rateCardFulltime: '',
        rateCardContract: '',
        billingPaymentTermsFulltime: '',
        billingPaymentTermsContract: '',
        contractDurationFlexibilityFulltime: '',
        contractDurationFlexibilityContract: '',
        nda: null,
        dataSecurityPrivacy: null,
        statutoryLegal: null,
        businessContinuity: null,
        informationSecurity: null,
        references: [
            { clientName: '', industry: '', engagementSummary: '', contact: '' },
            { clientName: '', industry: '', engagementSummary: '', contact: '' },
        ],
        engagementTypes: ['FULLTIME'],
    };
}
export function emptyEvaluationScores() {
    const scores = {};
    for (const p of EVALUATION_PARAMETERS) {
        scores[p.id] = { fulltime: null, contract: null };
    }
    return scores;
}
function clampScore(n) {
    if (n == null || n === '')
        return null;
    const v = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(v))
        return null;
    if (v < 1 || v > 5)
        return null;
    return Math.round(v);
}
export function parseOnboardingJson(raw) {
    const base = emptyOnboardingForm();
    if (!raw)
        return base;
    try {
        const parsed = JSON.parse(raw);
        return {
            ...base,
            ...parsed,
            references: Array.isArray(parsed.references) && parsed.references.length > 0
                ? parsed.references.map((r) => ({
                    clientName: r?.clientName ?? '',
                    industry: r?.industry ?? '',
                    engagementSummary: r?.engagementSummary ?? '',
                    contact: r?.contact ?? '',
                }))
                : base.references,
            engagementTypes: Array.isArray(parsed.engagementTypes) && parsed.engagementTypes.length > 0
                ? parsed.engagementTypes.filter((t) => t === 'FULLTIME' || t === 'CONTRACT')
                : base.engagementTypes,
        };
    }
    catch {
        return base;
    }
}
export function parseEvaluationJson(raw) {
    const base = emptyEvaluationScores();
    if (!raw)
        return base;
    try {
        const parsed = JSON.parse(raw);
        for (const p of EVALUATION_PARAMETERS) {
            const row = parsed[p.id];
            if (row) {
                base[p.id] = {
                    fulltime: clampScore(row.fulltime),
                    contract: clampScore(row.contract),
                };
            }
        }
        return base;
    }
    catch {
        return base;
    }
}
function scoreTrack(scores, track) {
    const breakdown = [];
    let totalWeight = 0;
    let weightedSum = 0;
    for (const p of EVALUATION_PARAMETERS) {
        const score = clampScore(scores[p.id]?.[track]);
        if (score == null)
            continue;
        const weightedScore = (score / 5) * p.weight;
        breakdown.push({
            parameterId: p.id,
            name: p.name,
            weight: p.weight,
            score,
            weightedScore: Math.round(weightedScore * 100) / 100,
        });
        totalWeight += p.weight;
        weightedSum += weightedScore;
    }
    if (breakdown.length === 0)
        return null;
    // Normalize if some params missing (partial drafts shouldn't reach submit)
    const percentage = totalWeight > 0
        ? Math.round((weightedSum / totalWeight) * 10000) / 100
        : 0;
    return { breakdown, percentage };
}
export function categorizePercentage(pct) {
    if (pct >= 85)
        return 'PREFERRED';
    if (pct >= 70)
        return 'APPROVED';
    if (pct >= 60)
        return 'CONDITIONAL';
    return 'NOT_RECOMMENDED';
}
export function computeScoring(scores, engagementTypes) {
    const wantsFt = engagementTypes.includes('FULLTIME');
    const wantsCt = engagementTypes.includes('CONTRACT');
    const fulltime = wantsFt ? scoreTrack(scores, 'fulltime') : null;
    const contract = wantsCt ? scoreTrack(scores, 'contract') : null;
    const parts = [];
    if (fulltime)
        parts.push(fulltime.percentage);
    if (contract)
        parts.push(contract.percentage);
    const overallPercentage = parts.length > 0
        ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100
        : 0;
    return {
        fulltime,
        contract,
        overallPercentage,
        category: categorizePercentage(overallPercentage),
    };
}
export function validateOnboardingComplete(data) {
    if (!data.engagementTypes.length)
        return 'Select at least one engagement type';
    const required = [
        ['legalName', 'Vendor legal name'],
        ['registeredAddress', 'Registered address'],
        ['primaryContactName', 'Primary contact name'],
        ['designation', 'Designation'],
        ['email', 'Email'],
        ['contactNumber', 'Contact number'],
        ['yearOfIncorporation', 'Year of incorporation'],
        ['totalEmployees', 'Total employees'],
        ['primaryServiceOfferings', 'Primary service offerings'],
        ['coreServiceCapabilities', 'Core service capabilities'],
        ['domainIndustryExperience', 'Domain / industry experience'],
        ['deliveryModel', 'Delivery model'],
        ['qualityAssuranceProcesses', 'Quality assurance processes'],
        ['slaKpiManagement', 'SLA / KPI management'],
        ['escalationGovernance', 'Escalation & governance model'],
    ];
    for (const [key, label] of required) {
        const v = data[key];
        if (typeof v === 'string' && !v.trim())
            return `${label} is required`;
    }
    if (data.engagementTypes.includes('FULLTIME')) {
        if (!data.pricingModelFulltime.trim())
            return 'Fulltime pricing model is required';
        if (!data.billingPaymentTermsFulltime.trim())
            return 'Fulltime billing & payment terms are required';
    }
    if (data.engagementTypes.includes('CONTRACT')) {
        if (!data.averageTeamSize.trim())
            return 'Average team size is required for contract';
        if (!data.skillAvailabilityBench.trim())
            return 'Skill availability & bench strength is required';
        if (!data.pricingModelContract.trim())
            return 'Contract pricing model is required';
        if (!data.billingPaymentTermsContract.trim())
            return 'Contract billing & payment terms are required';
        if (!data.contractDurationFlexibilityContract.trim()) {
            return 'Contract duration flexibility is required';
        }
        const compliance = [
            [data.nda, 'NDA / Confidentiality Agreement'],
            [data.dataSecurityPrivacy, 'Data Security & Privacy Policy'],
            [data.statutoryLegal, 'Statutory & Legal Compliance'],
            [data.businessContinuity, 'Business Continuity Plan'],
            [data.informationSecurity, 'Information Security Measures'],
        ];
        for (const [val, label] of compliance) {
            if (val == null)
                return `Confirm ${label}`;
        }
    }
    const filledRefs = data.references.filter((r) => r.clientName.trim() && r.engagementSummary.trim());
    if (filledRefs.length < 2)
        return 'Provide at least 2 client references';
    return null;
}
export function validateEvaluationComplete(scores, engagementTypes) {
    if (!engagementTypes.length)
        return 'Engagement types missing — complete onboarding first';
    for (const p of EVALUATION_PARAMETERS) {
        if (engagementTypes.includes('FULLTIME') && clampScore(scores[p.id]?.fulltime) == null) {
            return `Score all Fulltime parameters (missing: ${p.name})`;
        }
        if (engagementTypes.includes('CONTRACT') && clampScore(scores[p.id]?.contract) == null) {
            return `Score all Contract parameters (missing: ${p.name})`;
        }
    }
    return null;
}
export function isVendorPortalBlocked(status) {
    if (!status)
        return false; // grandfathered vendors without a record
    return status !== 'APPROVED';
}
export const HR_SCORE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'HR_HEAD'];
export const HR_APPROVER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'HR_HEAD'];
