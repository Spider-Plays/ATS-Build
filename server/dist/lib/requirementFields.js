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
function catalogMatchKey(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\band\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
const EMPLOYMENT_TYPE_LABELS = {
    REGULAR: 'Regular',
    CONSULTANT: 'Consultant',
    CONTRACT: 'Contract',
    GRADUATE_HIRE: 'Graduate Hire',
};
const JOB_TYPE_LABELS = {
    TECHNICAL: 'Technical',
    NON_TECHNICAL: 'Non-Technical',
};
const BUSINESS_TYPE_LABELS = {
    MANAGED_SERVICES: 'Managed Services',
    HUMAN_RESOURCE: 'Human Resource',
    GENERAL_ADMIN: 'General Admin',
    BUSINESS_DEVELOPMENT: 'Business Development',
    IGS_POOL: 'IGS-Pool',
    OTT: 'OTT',
    NON_OTT: 'Non OTT',
    TEST_OPS: 'Test Ops',
    SALES_AND_MARKETING: 'Sales and Marketing',
    IT_SYSTEM_ADMIN: 'IT/System Admin',
    FINANCE_ACCOUNTS: 'Finance / Accounts',
    STAFF_AUGMENTATION: 'Staff Augmentation',
};
const DOMAIN_LABELS = {
    HEALTHCARE: 'Healthcare',
    BANKING_FINANCIAL: 'Banking & Financial',
    INSURANCE: 'Insurance',
    AIRLINES: 'Airlines',
    EDUCATION_EDTECH: 'Education or Ed-Tech',
    ECOMMERCE_RETAIL: 'E-Commerce & Retail',
    OTT: 'OTT',
    GAMING: 'Gaming',
    TELECOMMUNICATION: 'Telecommunication',
    AUTOMOTIVE: 'Automotive',
    LOGISTICS: 'Logistics',
    HR_ADMIN: 'Human Resource & Admin',
    SALES_BD: 'Sales and Business Development',
};
const REQUIREMENT_FOR_LABELS = {
    NEW_POSITION: 'New Position',
    REPLACEMENT: 'Replacement',
    CONTRACT_CONVERSION: 'Contract Conversion',
    INTERN_CONVERSION: 'Intern Conversion',
};
const HIRE_CATEGORY_LABELS = {
    LATERAL: 'Lateral',
    FRESHER: 'Fresher',
    CONSULTANT: 'Consultant',
    CONTRACT: 'Contract',
};
/**
 * Accept a catalog code or its display label (legacy import stored labels).
 * Text that matches neither is kept, so an edit does not wipe imported values.
 */
export function resolveStoredEnum(value, allowed, labels) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const raw = value.trim();
    const direct = raw.toUpperCase();
    if (allowed.includes(direct))
        return direct;
    const coded = direct
        .replace(/&/g, 'AND')
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    if (allowed.includes(coded))
        return coded;
    const key = catalogMatchKey(raw);
    for (const code of allowed) {
        if (catalogMatchKey(code) === key || catalogMatchKey(labels[code] ?? '') === key)
            return code;
    }
    return raw;
}
export function parseOptionalDate(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== 'string' || !value.trim())
        return null;
    const calendar = parseCalendarDate(value);
    if (calendar)
        return calendar;
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
}
/** `yyyy-MM-dd` as a local calendar date (noon, so the day does not shift). */
export function parseCalendarDate(value) {
    if (typeof value !== 'string')
        return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return null;
    const d = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day)
        return null;
    return d;
}
/** Fiscal quarter label, e.g. `Q2 2026` (Jul–Sep). */
export function fiscalQuarterLabel(date) {
    const month = date.getMonth();
    const year = date.getFullYear();
    if (month >= 3 && month <= 5)
        return `Q1 ${year}`;
    if (month >= 6 && month <= 8)
        return `Q2 ${year}`;
    if (month >= 9 && month <= 11)
        return `Q3 ${year}`;
    return `Q4 ${year - 1}`;
}
export function calendarMonthKey(date) {
    return String(date.getMonth() + 1).padStart(2, '0');
}
export function parseOptionalString(value, maxLen) {
    if (typeof value !== 'string')
        return null;
    const s = value.trim();
    if (!s)
        return null;
    return s.slice(0, maxLen);
}
/** Whole-number CTC stored as a digit string. Allows a full amount such as 2400000 (₹24,00,000). */
const SALARY_BAND_MAX = 999_999_999;
function parseSalaryAmountDigits(raw) {
    let s = raw
        .replace(/₹/g, '')
        .replace(/\brs\.?/gi, '')
        .replace(/,/g, '')
        .replace(/\s/g, '');
    if (/^\d+\.0+$/.test(s))
        s = s.replace(/\.0+$/, '');
    if (/^\d+\.\d+$/.test(s)) {
        const rounded = Math.round(Number(s));
        if (!Number.isSafeInteger(rounded) || rounded < 1)
            return null;
        s = String(rounded);
    }
    if (!/^\d+$/.test(s))
        return null;
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < 1 || n > SALARY_BAND_MAX)
        return null;
    return String(n);
}
function parseOptionalSalaryLpa(value) {
    if (value === '' || value === null || value === undefined)
        return null;
    const raw = typeof value === 'number' ? String(value) : String(value).trim();
    if (!raw)
        return null;
    return parseSalaryAmountDigits(raw);
}
function parseRequiredSalaryLpa(value, label) {
    const s = parseOptionalSalaryLpa(value);
    if (!s) {
        throw new RequirementFieldError(`${label} must be a whole number from 1 to 99,99,99,999`);
    }
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
        hiringDeadline: parseOptionalDate(body.hiringDeadline),
        raisedOn: parseCalendarDate(body.raisedOn) ?? new Date(),
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
        out.employmentType = resolveStoredEnum(body.employmentType, EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS);
    }
    if (has('workMode'))
        out.workMode = resolveStoredEnum(body.workMode, WORK_MODES, WORK_MODE_LABELS);
    if (has('salaryBand')) {
        const salaryBand = parseOptionalSalaryLpa(body.salaryBand);
        if (salaryBand) {
            out.salaryBand = salaryBand;
        }
        else if (body.salaryBand === '' || body.salaryBand == null) {
            out.salaryBand = null;
        }
        else {
            // Keep imported free-text bands (ranges, comments) instead of failing the save.
            out.salaryBand = parseOptionalString(String(body.salaryBand), 80);
        }
    }
    if (has('targetStartDate'))
        out.targetStartDate = parseOptionalDate(body.targetStartDate);
    if (has('hiringDeadline'))
        out.hiringDeadline = parseOptionalDate(body.hiringDeadline);
    if (has('seniorityLevel')) {
        out.seniorityLevel = resolveStoredEnum(body.seniorityLevel, SENIORITY_LEVELS, SENIORITY_LABELS);
        if (out.seniorityLevel && !has('globalJobType')) {
            out.globalJobType =
                SENIORITY_LABELS[out.seniorityLevel] ?? out.seniorityLevel;
        }
    }
    if (has('globalJobType'))
        out.globalJobType = parseOptionalString(body.globalJobType, 120);
    if (has('hireType'))
        out.hireType = parseOptionalString(body.hireType, 120);
    if (has('businessType')) {
        out.businessType = resolveStoredEnum(body.businessType, BUSINESS_TYPES, BUSINESS_TYPE_LABELS);
    }
    if (has('domain'))
        out.domain = resolveStoredEnum(body.domain, DOMAINS, DOMAIN_LABELS);
    if (has('jobType'))
        out.jobType = resolveStoredEnum(body.jobType, JOB_TYPES, JOB_TYPE_LABELS);
    if (has('employmentChannel')) {
        out.employmentChannel = resolveStoredEnum(body.employmentChannel, EMPLOYMENT_CHANNELS, EMPLOYMENT_CHANNEL_LABELS);
        if (out.employmentChannel && !has('hireType')) {
            out.hireType =
                EMPLOYMENT_CHANNEL_LABELS[out.employmentChannel] ?? out.employmentChannel;
        }
    }
    if (has('requirementFor')) {
        out.requirementFor = resolveStoredEnum(body.requirementFor, REQUIREMENT_FOR_OPTIONS, REQUIREMENT_FOR_LABELS);
    }
    if (has('replacementEmployeeName')) {
        out.replacementEmployeeName = parseOptionalString(body.replacementEmployeeName, 200);
    }
    if (has('education')) {
        out.education = JSON.stringify(parseEducationList(body.education));
    }
    if (has('hireCategory')) {
        out.hireCategory = resolveStoredEnum(body.hireCategory, HIRE_CATEGORIES, HIRE_CATEGORY_LABELS);
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
            workMode: has('workMode')
                ? resolveStoredEnum(body.workMode, WORK_MODES, WORK_MODE_LABELS)
                : undefined,
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
