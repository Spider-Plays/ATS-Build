import { parseLegacyDate, rowGet } from './parseCsv.js';
import { parseSkillList, serializeSkills } from '../skills.js';
import { DEFAULT_DROPDOWN_CATALOGS } from '../../config/defaultDropdownCatalogs.js';
export const REPLACEMENT_DUE_TO_OPTIONS = (DEFAULT_DROPDOWN_CATALOGS.replacementDueToOptions ?? []).map((o) => o.value);
export function isChildRequirement(row) {
    return /^child\s*req$/i.test(rowGet(row, 'Req Type').trim());
}
export function mapLegacyPriority(raw) {
    const s = raw.trim().toUpperCase();
    if (!s || s === 'NA' || s === 'N/A')
        return null;
    if (s === 'P0' || s === 'CRITICAL')
        return 'CRITICAL';
    if (s === 'P1' || s === 'HIGH')
        return 'HIGH';
    if (s === 'P2' || s === 'MEDIUM')
        return 'MEDIUM';
    if (s === 'P3' || s === 'LOW')
        return 'LOW';
    return null;
}
export function mapRequisitionStatus(raw) {
    const s = raw.trim().toLowerCase();
    if (!s || s === 'na' || s === 'n/a')
        return 'CLOSED';
    if (/hold/.test(s))
        return 'ON_HOLD';
    if (/cancel|closed|fulfilil|joined|decline|internal fulfilment|internal fulfillment/.test(s)) {
        return 'CLOSED';
    }
    return 'LIVE';
}
export function parseExperienceRange(raw) {
    const s = raw.trim();
    if (!s)
        return { min: null, max: null };
    const range = s.match(/(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)/i);
    if (range)
        return { min: Number(range[1]), max: Number(range[2]) };
    const plus = s.match(/(\d+(?:\.\d+)?)\s*\+/);
    if (plus)
        return { min: Number(plus[1]), max: null };
    const single = s.match(/(\d+(?:\.\d+)?)/);
    if (single)
        return { min: Number(single[1]), max: Number(single[1]) };
    return { min: null, max: null };
}
export function parseNonNegativeInt(raw) {
    const cleaned = raw.replace(/,/g, '').trim();
    if (!cleaned || /^(na|n\/a|nil|-)$/i.test(cleaned))
        return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n))
        return null;
    return Math.max(0, Math.round(n));
}
export function nullIfNa(raw) {
    const s = raw.trim();
    if (!s || /^(na|n\/a|nil|null|-|none|select option)$/i.test(s))
        return null;
    return s;
}
export function computeHoldDays(start, end) {
    if (!start || !end)
        return null;
    const ms = end.getTime() - start.getTime();
    if (!Number.isFinite(ms))
        return null;
    return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}
export function mapReplacementDueTo(raw) {
    const s = nullIfNa(raw);
    if (!s)
        return null;
    const lower = s.toLowerCase();
    for (const opt of REPLACEMENT_DUE_TO_OPTIONS) {
        if (opt.toLowerCase() === lower)
            return opt;
    }
    if (/resign/.test(lower))
        return 'Resignation';
    if (/terminat/.test(lower))
        return 'Termination';
    if (/promot/.test(lower))
        return 'Promotion';
    if (/internal/.test(lower))
        return 'Internal movement';
    if (/pool/.test(lower))
        return 'Pool resource';
    return s;
}
export function mapRequirementFor(raw) {
    const s = nullIfNa(raw);
    if (!s)
        return null;
    const lower = s.toLowerCase();
    if (/new\s*position/.test(lower))
        return 'NEW_POSITION';
    if (/replac/.test(lower))
        return 'REPLACEMENT';
    if (/contract/.test(lower))
        return 'CONTRACT_CONVERSION';
    if (/intern/.test(lower))
        return 'INTERN_CONVERSION';
    return s;
}
export function mapJobType(raw) {
    const s = nullIfNa(raw);
    if (!s)
        return null;
    if (/non[-\s]?tech/i.test(s))
        return 'NON_TECHNICAL';
    if (/tech/i.test(s))
        return 'TECHNICAL';
    return s;
}
export function mapHireCategory(raw) {
    const s = nullIfNa(raw);
    if (!s)
        return null;
    const upper = s.toUpperCase().replace(/\s+/g, '_');
    if (/lateral/i.test(s))
        return 'LATERAL';
    if (/fresher/i.test(s))
        return 'FRESHER';
    if (/consultant/i.test(s))
        return 'CONSULTANT';
    if (/contract/i.test(s))
        return 'CONTRACT';
    return upper;
}
export function buildManpowerRequirementPayload(reqId, row, recruiterIds, fallbackUserId, hiringManagerId) {
    const primaryRecruiterId = recruiterIds[0] ?? fallbackUserId;
    const reqStatus = mapRequisitionStatus(rowGet(row, 'Requisition Status-CR'));
    const experienceLabel = nullIfNa(rowGet(row, 'Experience'));
    const experienceRange = parseExperienceRange(experienceLabel || '');
    const holdStartDate = parseLegacyDate(rowGet(row, 'Hold Start Date'));
    const holdEndDate = parseLegacyDate(rowGet(row, 'Hold End Date'));
    const holdDays = computeHoldDays(holdStartDate, holdEndDate) ??
        parseNonNegativeInt(rowGet(row, 'Hold Days', 'Total Hold Days'));
    const closureDate = parseLegacyDate(rowGet(row, 'Requisition Closure Date'));
    const createdAt = parseLegacyDate(rowGet(row, 'Date of Requisition')) ?? undefined;
    const targetStartDate = parseLegacyDate(rowGet(row, 'Target Start Date'));
    const joiningDate = parseLegacyDate(rowGet(row, 'Date of Joining'));
    const orgUnit = nullIfNa(rowGet(row, 'Org Unit')) || 'General';
    const projectName = nullIfNa(rowGet(row, 'Project/Department New'));
    const jd = nullIfNa(rowGet(row, 'Job Description (JD)'));
    const approvalStatus = nullIfNa(rowGet(row, 'Approval Status'));
    const cancellationStatus = nullIfNa(rowGet(row, 'Cancellation Status'));
    const replacementDueTo = mapReplacementDueTo(rowGet(row, 'Replacement due to'));
    const requirementFor = mapRequirementFor(rowGet(row, 'Recruitment is for'));
    const location = nullIfNa(rowGet(row, 'Location'));
    const agingDays = parseNonNegativeInt(rowGet(row, 'Actual Req Aging(In Days)'));
    const vendorName = nullIfNa(rowGet(row, 'Vendor'));
    const approval = approvalStatus && /approv/i.test(approvalStatus)
        ? JSON.stringify({
            decision: 'APPROVED',
            comments: approvalStatus,
            decidedAt: createdAt?.toISOString?.() ?? new Date().toISOString(),
        })
        : approvalStatus && /reject/i.test(approvalStatus)
            ? JSON.stringify({
                decision: 'REJECTED',
                comments: approvalStatus,
                decidedAt: new Date().toISOString(),
            })
            : null;
    return {
        jobCode: reqId,
        parentJobCode: nullIfNa(rowGet(row, 'Parent Req No')),
        client: nullIfNa(rowGet(row, 'Client Name')) || 'Legacy Import',
        title: nullIfNa(rowGet(row, 'Job Title')) || `Requirement ${reqId}`,
        department: orgUnit,
        projectName,
        orgUnit,
        quarter: nullIfNa(rowGet(row, 'Quarter', 'Requisition Quarter')),
        reqMonth: nullIfNa(rowGet(row, 'Req-Month', 'Requisition Month')),
        hiringManager: hiringManagerId,
        status: reqStatus,
        hiringStage: 'SOURCING',
        liveAt: reqStatus === 'LIVE' ? createdAt || new Date() : null,
        onHoldAt: reqStatus === 'ON_HOLD' ? holdStartDate || new Date() : null,
        openings: Math.max(Number(rowGet(row, 'No of Position')) || 1, 1),
        filled: 0,
        priority: mapLegacyPriority(rowGet(row, 'Priority')),
        location,
        locationCity: location,
        isRemote: Boolean(location && /remote|wfh|work\s*from\s*home/i.test(location)),
        workMode: location && /remote|wfh/i.test(location) ? 'REMOTE' : location ? 'ONSITE' : null,
        employmentType: nullIfNa(rowGet(row, 'Type of employment')),
        hireType: nullIfNa(rowGet(row, 'Hire Type')),
        seniorityLevel: nullIfNa(rowGet(row, 'Global Job Type')),
        globalJobType: nullIfNa(rowGet(row, 'Global Job Type')),
        businessType: nullIfNa(rowGet(row, 'Business Type')),
        domain: nullIfNa(rowGet(row, 'Domain')),
        jobType: mapJobType(rowGet(row, 'Interview Category')),
        employmentChannel: nullIfNa(rowGet(row, 'Hire Type')),
        requirementFor,
        replacementDueTo,
        replacementEmployeeName: nullIfNa(rowGet(row, 'Replacement for')),
        joinedEmployeeName: nullIfNa(rowGet(row, 'Employee Name')),
        joinedEmployeeId: nullIfNa(rowGet(row, 'Employee ID')),
        education: serializeSkills(parseSkillList(rowGet(row, 'Desired qualification'))),
        hireCategory: mapHireCategory(rowGet(row, 'Hire Category')),
        holdStartDate,
        holdEndDate,
        holdDays,
        agingDays,
        experienceMinYears: experienceRange.min == null ? null : Math.round(experienceRange.min),
        experienceMaxYears: experienceRange.max == null ? null : Math.round(experienceRange.max),
        experienceLabel,
        salaryBand: nullIfNa(rowGet(row, 'Compensation Budget')),
        targetStartDate,
        hiringDeadline: null,
        description: jd,
        jobDescription: jd,
        primarySkills: serializeSkills(parseSkillList(rowGet(row, 'Desired / Primary skill'))),
        secondarySkills: '[]',
        createdBy: primaryRecruiterId,
        recruiters: JSON.stringify(recruiterIds),
        assignedVendorName: vendorName,
        approvalStatus,
        cancellationStatus,
        onboardSource: nullIfNa(rowGet(row, 'Source')),
        referrerName: nullIfNa(rowGet(row, 'Referrer')),
        joiningDate,
        joinedMonth: nullIfNa(rowGet(row, 'Joined Month')),
        joinedQuarter: nullIfNa(rowGet(row, 'Joined Quarter')),
        approval,
        closureReason: cancellationStatus || (reqStatus === 'CLOSED' ? nullIfNa(rowGet(row, 'Requisition Status-CR')) : null),
        closedAt: reqStatus === 'CLOSED' ? closureDate || new Date() : closureDate,
        visibleToCandidates: true,
        visibleToVendors: Boolean(vendorName),
        visibleToReferrals: true,
        ...(createdAt ? { createdAt } : {}),
        _reqStatus: reqStatus,
        _recruiterCount: recruiterIds.length,
        _vendorName: vendorName,
    };
}
export function sourceMonthFromDate(date) {
    if (!date)
        return null;
    return date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
}
export function sourceWeekFromDate(date) {
    if (!date)
        return null;
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `W${week}`;
}
