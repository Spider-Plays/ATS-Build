export const EMPLOYMENT_TYPES = ['REGULAR', 'CONSULTANT', 'CONTRACT', 'GRADUATE_HIRE'];
export const WORK_MODES = ['REMOTE', 'HYBRID', 'ONSITE'];
export const SENIORITY_LEVELS = [
    'ENTRY_LEVEL',
    'INTERMEDIATE',
    'SPECIALIST',
    'MANAGER',
    'MASTER',
];
export const JOB_TYPES = ['TECHNICAL', 'NON_TECHNICAL'];
export const EMPLOYMENT_CHANNELS = ['EXTERNAL', 'INTERNAL'];
export const REQUIREMENT_FOR_OPTIONS = [
    'NEW_POSITION',
    'REPLACEMENT',
    'CONTRACT_CONVERSION',
    'INTERN_CONVERSION',
];
export const HIRE_CATEGORIES = ['LATERAL', 'FRESHER', 'CONSULTANT', 'CONTRACT'];
const EMPLOYMENT_CHANNEL_LABELS = {
    EXTERNAL: 'External',
    INTERNAL: 'Internal',
};
const SENIORITY_LABELS = {
    ENTRY_LEVEL: 'Entry Level',
    INTERMEDIATE: 'Intermediate',
    SPECIALIST: 'Specialist',
    MANAGER: 'Manager',
    MASTER: 'Master',
};
export const BUSINESS_TYPES = [
    'MANAGED_SERVICES',
    'HUMAN_RESOURCE',
    'GENERAL_ADMIN',
    'BUSINESS_DEVELOPMENT',
    'IGS_POOL',
    'OTT',
    'NON_OTT',
    'TEST_OPS',
    'SALES_AND_MARKETING',
    'IT_SYSTEM_ADMIN',
    'FINANCE_ACCOUNTS',
    'STAFF_AUGMENTATION',
];
export const DOMAINS = [
    'HEALTHCARE',
    'BANKING_FINANCIAL',
    'INSURANCE',
    'AIRLINES',
    'EDUCATION_EDTECH',
    'ECOMMERCE_RETAIL',
    'OTT',
    'GAMING',
    'TELECOMMUNICATION',
    'AUTOMOTIVE',
    'LOGISTICS',
    'HR_ADMIN',
    'SALES_BD',
];
export const EDUCATION_OPTIONS = [
    'BACHELORS',
    'MASTERS',
    'DIPLOMA',
    'MBA',
    'MCA',
    'BTECH_BE',
    'MTECH',
    'PHD',
    'OTHER',
];
const WORK_MODE_LABELS = {
    REMOTE: 'Remote',
    HYBRID: 'Hybrid',
    ONSITE: 'On-site',
};
export function parseOptionalInt(value, max = 50) {
    if (value === '' || value === null || value === undefined)
        return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0 || n > max)
        return null;
    return Math.floor(n);
}
export function parseOptionalEnum(value, allowed) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const v = value.trim().toUpperCase();
    return allowed.includes(v) ? v : null;
}
export function parseOptionalDate(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== 'string' || !value.trim())
        return null;
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
}
export function parseOptionalString(value, maxLen) {
    if (typeof value !== 'string')
        return null;
    const s = value.trim();
    if (!s)
        return null;
    return s.slice(0, maxLen);
}
/** Whole-number CTC in LPA, stored as a digit string. */
function parseOptionalSalaryLpa(value) {
    if (value === '' || value === null || value === undefined)
        return null;
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 999)
        return null;
    return String(n);
}
function parseRequiredSalaryLpa(value, label) {
    const s = parseOptionalSalaryLpa(value);
    if (!s)
        throw new RequirementFieldError(`${label} must be a whole number between 1 and 999`);
    return s;
}
function parseEducationList(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const v = item.trim().toUpperCase();
        if (!v)
            continue;
        if (EDUCATION_OPTIONS.includes(v) && !out.includes(v))
            out.push(v);
    }
    return out;
}
export function buildLocationDisplay(input) {
    const city = input.locationCity?.trim();
    const mode = input.workMode ? WORK_MODE_LABELS[input.workMode] ?? input.workMode : null;
    const parts = [city, mode ?? (input.isRemote ? 'Remote' : null)].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
}
function validateExperienceRange(min, max) {
    if (min != null && max != null && max < min) {
        throw new RequirementFieldError('Maximum experience must be greater than or equal to minimum');
    }
}
function parseRequiredInt(value, label, max = 50) {
    const n = parseOptionalInt(value, max);
    if (n === null)
        throw new RequirementFieldError(`${label} is required`);
    return n;
}
function parseRequiredEnum(value, allowed, label) {
    const v = parseOptionalEnum(value, allowed);
    if (!v)
        throw new RequirementFieldError(`${label} is required`);
    return v;
}
function parseRequiredString(value, label, maxLen) {
    const s = parseOptionalString(value, maxLen);
    if (!s)
        throw new RequirementFieldError(`${label} is required`);
    return s;
}
/** Canonical month key `01`–`12`. */
function parseOptionalMonth(value) {
    if (value === '' || value === null || value === undefined)
        return null;
    const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (!raw)
        return null;
    if (/^\d{1,2}$/.test(raw)) {
        const n = Number(raw);
        if (n >= 1 && n <= 12)
            return String(n).padStart(2, '0');
    }
    return null;
}
function parseRequiredMonth(value, label) {
    const m = parseOptionalMonth(value);
    if (!m)
        throw new RequirementFieldError(`${label} is required`);
    return m;
}
function parseRequiredDate(value, label) {
    const d = parseOptionalDate(value);
    if (!d)
        throw new RequirementFieldError(`${label} is required`);
    return d;
}
function parseHoldDates(startRaw, endRaw) {
    const holdStartDate = parseOptionalDate(startRaw);
    const holdEndDate = parseOptionalDate(endRaw);
    if (holdStartDate && holdEndDate && holdEndDate < holdStartDate) {
        throw new RequirementFieldError('Hold end date must be on or after hold start date');
    }
    return { holdStartDate, holdEndDate };
}
/** Validates and parses extended fields for POST /requirements (all required). */
export function pickRequirementExtrasForCreate(body) {
    const experienceMinYears = parseRequiredInt(body.experienceMinYears, 'Minimum experience');
    const experienceMaxYears = parseRequiredInt(body.experienceMaxYears, 'Maximum experience');
    validateExperienceRange(experienceMinYears, experienceMaxYears);
    const locationCity = parseRequiredString(body.locationCity, 'City', 120);
    const workMode = parseRequiredEnum(body.workMode, WORK_MODES, 'Work mode');
    const isRemote = false;
    const requirementFor = parseRequiredEnum(body.requirementFor, REQUIREMENT_FOR_OPTIONS, 'Requirement for');
    const replacementEmployeeName = requirementFor === 'REPLACEMENT'
        ? parseRequiredString(body.replacementEmployeeName, 'Employee being replaced', 200)
        : parseOptionalString(body.replacementEmployeeName, 200);
    const education = parseEducationList(body.education);
    if (education.length === 0) {
        throw new RequirementFieldError('Select at least one education option');
    }
    const employmentChannel = parseRequiredEnum(body.employmentChannel, EMPLOYMENT_CHANNELS, 'Type of employment');
    const seniorityLevel = parseRequiredEnum(body.seniorityLevel, SENIORITY_LEVELS, 'Global job type');
    return {
        experienceMinYears,
        experienceMaxYears,
        employmentType: parseRequiredEnum(body.employmentType, EMPLOYMENT_TYPES, 'Employment type'),
        workMode,
        salaryBand: parseRequiredSalaryLpa(body.salaryBand, 'Salary / CTC'),
        targetStartDate: parseRequiredDate(body.targetStartDate, 'Target start date'),
        hiringDeadline: parseRequiredDate(body.hiringDeadline, 'Hiring deadline'),
        seniorityLevel,
        /** Keep legacy display fields in sync with modern enums. */
        globalJobType: parseOptionalString(body.globalJobType, 120) ??
            SENIORITY_LABELS[seniorityLevel] ??
            seniorityLevel,
        hireType: parseOptionalString(body.hireType, 120) ??
            EMPLOYMENT_CHANNEL_LABELS[employmentChannel] ??
            employmentChannel,
        businessType: parseRequiredEnum(body.businessType, BUSINESS_TYPES, 'Business type'),
        domain: parseRequiredEnum(body.domain, DOMAINS, 'Domain'),
        jobType: parseRequiredEnum(body.jobType, JOB_TYPES, 'Job type'),
        employmentChannel,
        requirementFor,
        replacementEmployeeName,
        education: JSON.stringify(education),
        hireCategory: parseRequiredEnum(body.hireCategory, HIRE_CATEGORIES, 'Hire category'),
        locationCity,
        isRemote,
        location: buildLocationDisplay({ locationCity, workMode, isRemote }) ??
            parseOptionalString(body.location, 200),
        projectName: parseRequiredString(body.projectName, 'Project name', 200),
        quarter: parseRequiredString(body.quarter, 'Quarter', 32),
        reqMonth: parseRequiredMonth(body.reqMonth, 'Month'),
        orgUnit: parseOptionalString(body.orgUnit, 200) ??
            parseOptionalString(body.department, 200),
    };
}
/** Only parses fields present in the patch body (partial update). */
export function pickRequirementExtrasPatch(body) {
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    if (has('experienceMinYears') || has('experienceMaxYears')) {
        const experienceMinYears = has('experienceMinYears')
            ? parseOptionalInt(body.experienceMinYears)
            : undefined;
        const experienceMaxYears = has('experienceMaxYears')
            ? parseOptionalInt(body.experienceMaxYears)
            : undefined;
        if (has('experienceMinYears'))
            out.experienceMinYears = experienceMinYears;
        if (has('experienceMaxYears'))
            out.experienceMaxYears = experienceMaxYears;
        validateExperienceRange(out.experienceMinYears ?? null, out.experienceMaxYears ?? null);
    }
    if (has('employmentType')) {
        out.employmentType = parseOptionalEnum(body.employmentType, EMPLOYMENT_TYPES);
    }
    if (has('workMode'))
        out.workMode = parseOptionalEnum(body.workMode, WORK_MODES);
    if (has('salaryBand')) {
        const salaryBand = parseOptionalSalaryLpa(body.salaryBand);
        if (body.salaryBand !== '' && body.salaryBand != null && salaryBand === null) {
            throw new RequirementFieldError('Salary / CTC must be a whole number between 1 and 999');
        }
        out.salaryBand = salaryBand;
    }
    if (has('targetStartDate'))
        out.targetStartDate = parseOptionalDate(body.targetStartDate);
    if (has('hiringDeadline'))
        out.hiringDeadline = parseOptionalDate(body.hiringDeadline);
    if (has('seniorityLevel')) {
        out.seniorityLevel = parseOptionalEnum(body.seniorityLevel, SENIORITY_LEVELS);
        if (out.seniorityLevel && !has('globalJobType')) {
            out.globalJobType =
                SENIORITY_LABELS[out.seniorityLevel] ?? out.seniorityLevel;
        }
    }
    if (has('globalJobType'))
        out.globalJobType = parseOptionalString(body.globalJobType, 120);
    if (has('hireType'))
        out.hireType = parseOptionalString(body.hireType, 120);
    if (has('businessType'))
        out.businessType = parseOptionalEnum(body.businessType, BUSINESS_TYPES);
    if (has('domain'))
        out.domain = parseOptionalEnum(body.domain, DOMAINS);
    if (has('jobType'))
        out.jobType = parseOptionalEnum(body.jobType, JOB_TYPES);
    if (has('employmentChannel')) {
        out.employmentChannel = parseOptionalEnum(body.employmentChannel, EMPLOYMENT_CHANNELS);
        if (out.employmentChannel && !has('hireType')) {
            out.hireType =
                EMPLOYMENT_CHANNEL_LABELS[out.employmentChannel] ?? out.employmentChannel;
        }
    }
    if (has('requirementFor')) {
        out.requirementFor = parseOptionalEnum(body.requirementFor, REQUIREMENT_FOR_OPTIONS);
    }
    if (has('replacementEmployeeName')) {
        out.replacementEmployeeName = parseOptionalString(body.replacementEmployeeName, 200);
    }
    if (has('education')) {
        out.education = JSON.stringify(parseEducationList(body.education));
    }
    if (has('hireCategory')) {
        out.hireCategory = parseOptionalEnum(body.hireCategory, HIRE_CATEGORIES);
    }
    if (has('holdStartDate') || has('holdEndDate')) {
        const { holdStartDate, holdEndDate } = parseHoldDates(body.holdStartDate, body.holdEndDate);
        if (has('holdStartDate'))
            out.holdStartDate = holdStartDate;
        if (has('holdEndDate'))
            out.holdEndDate = holdEndDate;
    }
    if (has('positionSlots')) {
        out.positionSlots =
            typeof body.positionSlots === 'string'
                ? body.positionSlots
                : JSON.stringify(body.positionSlots ?? []);
    }
    if (has('locationCity'))
        out.locationCity = parseOptionalString(body.locationCity, 120);
    if (has('isRemote'))
        out.isRemote = Boolean(body.isRemote);
    if (has('location'))
        out.location = parseOptionalString(body.location, 200);
    if (has('projectName'))
        out.projectName = parseOptionalString(body.projectName, 200);
    if (has('quarter'))
        out.quarter = parseOptionalString(body.quarter, 32);
    if (has('reqMonth')) {
        const month = parseOptionalMonth(body.reqMonth);
        if (body.reqMonth !== '' && body.reqMonth != null && month === null) {
            throw new RequirementFieldError('Month must be a value from 01 to 12');
        }
        out.reqMonth = month;
    }
    if (has('orgUnit'))
        out.orgUnit = parseOptionalString(body.orgUnit, 200);
    if (has('locationCity') || has('workMode') || has('isRemote')) {
        out.location = buildLocationDisplay({
            locationCity: has('locationCity')
                ? parseOptionalString(body.locationCity, 120)
                : undefined,
            workMode: has('workMode') ? parseOptionalEnum(body.workMode, WORK_MODES) : undefined,
            isRemote: has('isRemote') ? Boolean(body.isRemote) : undefined,
        });
    }
    if ((out.requirementFor === 'REPLACEMENT' ||
        (has('requirementFor') && body.requirementFor === 'REPLACEMENT')) &&
        has('replacementEmployeeName') &&
        !out.replacementEmployeeName) {
        throw new RequirementFieldError('Employee being replaced is required for Replacement');
    }
    return out;
}
export class RequirementFieldError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RequirementFieldError';
    }
}
