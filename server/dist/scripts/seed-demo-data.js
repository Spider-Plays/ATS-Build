import '../config/loadEnv.js';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { DEV_USERS, DEV_PASSWORD, devUserEmail } from '../config/devUsers.js';
import { DEMO_BUSINESS_REQUIREMENTS, DEMO_CANDIDATES, DEMO_CHANGE_REQUESTS, DEMO_PORTAL_USERS, DEMO_REQUIREMENTS, DEMO_VENDOR_CODE, DEMO_VENDOR_NAME, } from '../config/demoData.js';
import { DEMO_CLIENT_NAMES } from '../config/demoDataBulk.js';
import { DEMO_CLIENT_DEALS, DEMO_COVERAGE_BUSINESS_REQUIREMENTS, DEMO_COVERAGE_CANDIDATES, DEMO_COVERAGE_REQUIREMENTS, } from '../config/demoDataCoverage.js';
import { ensureDefaultClientCatalog } from '../lib/clientCatalog.js';
import { ensureDefaultDepartmentCatalog } from '../lib/departmentCatalog.js';
import { ensureDefaultSkillCatalog } from '../lib/skillCatalog.js';
import { ensureDefaultCityCatalog } from '../lib/cityCatalog.js';
import { ensureMarketTrendsTables } from '../lib/ensureMarketTrendsTables.js';
import { businessStagePercentage, linkedRequirementStagePercentage, } from '../lib/businessStages.js';
import { ensureChangeRequestTable } from '../lib/ensureChangeRequestTable.js';
import { deserializeSkills, serializeSkills } from '../lib/skills.js';
import { saveResumeFile } from '../lib/resumeStorage.js';
import { buildCandidateResumePayload, extractResumeText, } from '../lib/resumeParse.js';
import { buildCandidateSearchIndexFields } from '../lib/candidateFieldNormalize.js';
import { demoResumeFileName, renderDemoCandidateResumePdf } from '../lib/demoResumePdf.js';
import { closePdfBrowser } from '../lib/offerPdf.js';
import { computeMatchScore } from '../lib/profileMatching.js';
import { findCandidateByEmail } from '../lib/candidateDuplicate.js';
import { ensureInterviewPlan } from '../lib/interviewPlan.js';
import { configureDefaultInterviewPanels } from '../lib/interviewPanelCatalog.js';
import { removeLegacyDevUsers } from '../lib/legacyDevUsers.js';
import { migrateRequirementJobCodes } from '../lib/jobCode.js';
import { logActivity } from '../services/activityLog.js';
import { syncRequirementPositionSlots } from '../lib/syncRequirementPositionSlots.js';
import { emptyEvaluationScores, emptyOnboardingForm, } from '../lib/vendorOnboarding.js';
/** Demo data: allow sufficient candidates per stage for rich reports coverage. */
const DEMO_MAX_PER_STAGE = 40;
function takeAtMostPerKey(items, keyFn, max = DEMO_MAX_PER_STAGE) {
    const counts = new Map();
    const out = [];
    for (const item of items) {
        const key = keyFn(item);
        const n = counts.get(key) ?? 0;
        if (n >= max)
            continue;
        counts.set(key, n + 1);
        out.push(item);
    }
    return out;
}
const FRESH = process.argv.includes('--fresh');
const FORCE = process.argv.includes('--force');
/** Mirrors `src/config/interviewFeedbackForm.ts` COMPETENCY_TOPICS. */
const COMPETENCY_TOPICS = [
    'Ability to understand technical questions at 1st go?',
    'Problem solving and Critical Thinking?',
    'Attention to Detail?',
    'Ability to troubleshoot, debug code & log analysis?',
    'Overall communication Skills?',
    'Current Project understanding?',
    'General Technical Awareness of current industry?',
    'Innovation and Process improvement?',
];
const COMPETENCY_RATINGS = [4, 5, 4, 4, 4, 3, 4, 3];
function proficiencyForRating(rating) {
    if (rating >= 5)
        return 'Expert';
    if (rating >= 4)
        return 'Advanced';
    if (rating >= 3)
        return 'Intermediate';
    if (rating >= 2)
        return 'Beginner';
    return 'Not Assessed';
}
function buildCompleteDemoFeedback(skills, outcome = 'hire') {
    const skillList = skills.length > 0 ? skills.slice(0, 6) : ['General technical fit', 'Problem solving', 'Communication'];
    const skillAssessment = skillList.map((skill, i) => {
        const rating = outcome === 'reject' ? (i === 0 ? 3 : i < 3 ? 2 : 2) : i === 0 ? 5 : i < 3 ? 4 : 3;
        return {
            skillAssessed: skill,
            expectedProficiency: i < 2 ? 'Advanced' : 'Intermediate',
            possessProficiency: proficiencyForRating(rating),
            rating,
            remarks: outcome === 'reject'
                ? `Gaps on ${skill}; struggled with scenario depth and edge cases.`
                : rating >= 4
                    ? `Solid hands-on experience with ${skill}; answered scenario questions confidently.`
                    : `Adequate ${skill} for the role; some gaps on deeper edge cases.`,
        };
    });
    const competencies = COMPETENCY_TOPICS.map((topic, i) => {
        const rating = outcome === 'reject' ? 2 : (COMPETENCY_RATINGS[i] ?? 4);
        return {
            topic,
            rating,
            remarks: outcome === 'reject'
                ? 'Did not meet the bar for this competency in the discussion.'
                : rating >= 4
                    ? 'Demonstrated clearly during the discussion with concrete examples.'
                    : 'Acceptable; would benefit from more depth in follow-up rounds.',
        };
    });
    const skillRatings = skillAssessment.map((s) => s.rating);
    const compRatings = competencies.map((c) => c.rating);
    const all = [...skillRatings, ...compRatings];
    const rating = all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : outcome === 'reject' ? 2 : 4;
    const technicalRating = skillRatings.length
        ? Math.round(skillRatings.reduce((a, b) => a + b, 0) / skillRatings.length)
        : outcome === 'reject'
            ? 2
            : 4;
    const communicationRating = competencies.find((c) => c.topic.toLowerCase().includes('communication'))?.rating ??
        (outcome === 'reject' ? 2 : 4);
    return {
        formData: JSON.stringify({ skillAssessment, competencies }),
        rating,
        technicalRating,
        communicationRating,
        comments: outcome === 'reject'
            ? 'Does not meet the bar for this round — gaps in depth and problem solving. Recommend not proceeding.'
            : 'Strong candidate — solid technical depth and clear communication across skill and competency areas. Recommend proceeding.',
        recommendation: (outcome === 'reject' ? 'NO_HIRE' : 'HIRE'),
    };
}
function isInterviewRejectStatus(status) {
    return (status === 'L1_INTERVIEW_REJECT' ||
        status === 'MANAGERIAL_INTERVIEW_REJECT' ||
        status === 'CLIENT_INTERVIEW_REJECT' ||
        status === 'HR_INTERVIEW_REJECT');
}
/** Index of the plan stage where the candidate was rejected (default L1/L2/HR plan). */
function rejectStageIndex(status) {
    switch (status) {
        case 'L1_INTERVIEW_REJECT':
            return 0;
        case 'MANAGERIAL_INTERVIEW_REJECT':
        case 'CLIENT_INTERVIEW_REJECT':
            // Default plan has L1 → L2 → HR (no separate client stage); both fail at L2.
            return 1;
        case 'HR_INTERVIEW_REJECT':
            return 2;
        default:
            return null;
    }
}
function feedbackFormDataIsIncomplete(raw) {
    if (!raw || raw.trim() === '' || raw.trim() === '{}')
        return true;
    try {
        const parsed = JSON.parse(raw);
        const skills = Array.isArray(parsed.skillAssessment) ? parsed.skillAssessment : [];
        const comps = Array.isArray(parsed.competencies) ? parsed.competencies : [];
        if (skills.length === 0)
            return true;
        if (comps.length < COMPETENCY_TOPICS.length)
            return true;
        const anyEmptyComp = comps.some((c) => !(Number(c.rating) > 0) || !String(c.remarks ?? '').trim());
        return anyEmptyComp;
    }
    catch {
        return true;
    }
}
async function backfillIncompleteFeedbacks() {
    const feedbacks = await prisma.feedback.findMany({
        select: { id: true, candidateId: true, formData: true },
    });
    let updated = 0;
    for (const fb of feedbacks) {
        if (!feedbackFormDataIsIncomplete(fb.formData))
            continue;
        const candidate = await prisma.candidate.findUnique({
            where: { id: fb.candidateId },
            select: { primarySkills: true, secondarySkills: true },
        });
        const skills = [
            ...deserializeSkills(candidate?.primarySkills),
            ...deserializeSkills(candidate?.secondarySkills),
        ];
        const complete = buildCompleteDemoFeedback(skills);
        await prisma.feedback.update({
            where: { id: fb.id },
            data: {
                formData: complete.formData,
                rating: complete.rating,
                technicalRating: complete.technicalRating,
                communicationRating: complete.communicationRating,
                comments: complete.comments,
                recommendation: complete.recommendation,
            },
        });
        updated++;
    }
    return updated;
}
const EMPLOYMENT_TYPE_MAP = {
    FULL_TIME: 'REGULAR',
    PART_TIME: 'CONTRACT',
    INTERN: 'GRADUATE_HIRE',
    REGULAR: 'REGULAR',
    CONSULTANT: 'CONSULTANT',
    CONTRACT: 'CONTRACT',
    GRADUATE_HIRE: 'GRADUATE_HIRE',
};
const SENIORITY_MAP = {
    JUNIOR: 'ENTRY_LEVEL',
    MID: 'INTERMEDIATE',
    SENIOR: 'SPECIALIST',
    LEAD: 'MANAGER',
    PRINCIPAL: 'MASTER',
    ENTRY_LEVEL: 'ENTRY_LEVEL',
    INTERMEDIATE: 'INTERMEDIATE',
    SPECIALIST: 'SPECIALIST',
    MANAGER: 'MANAGER',
    MASTER: 'MASTER',
};
const CLIENT_DOMAIN = {
    Razorpay: 'BANKING_FINANCIAL',
    PhonePe: 'BANKING_FINANCIAL',
    Paytm: 'BANKING_FINANCIAL',
    'HDFC Bank': 'BANKING_FINANCIAL',
    'ICICI Bank': 'BANKING_FINANCIAL',
    Groww: 'BANKING_FINANCIAL',
    Zerodha: 'BANKING_FINANCIAL',
    CRED: 'BANKING_FINANCIAL',
    Freshworks: 'SALES_BD',
    Swiggy: 'ECOMMERCE_RETAIL',
    Flipkart: 'ECOMMERCE_RETAIL',
    'Amazon India': 'ECOMMERCE_RETAIL',
    Nykaa: 'ECOMMERCE_RETAIL',
    Meesho: 'ECOMMERCE_RETAIL',
    'Reliance Retail': 'ECOMMERCE_RETAIL',
    Policybazaar: 'INSURANCE',
    Acko: 'INSURANCE',
    Airtel: 'TELECOMMUNICATION',
    'Jio Platforms': 'TELECOMMUNICATION',
    "Byju's": 'EDUCATION_EDTECH',
    Unacademy: 'EDUCATION_EDTECH',
    Zoho: 'EDUCATION_EDTECH',
    Ola: 'LOGISTICS',
    'Uber India': 'LOGISTICS',
    'Apollo Hospitals': 'HEALTHCARE',
    'Mahindra & Mahindra': 'AUTOMOTIVE',
    'Tata Motors': 'AUTOMOTIVE',
    'Disney+ Hotstar': 'OTT',
    SonyLIV: 'OTT',
    Dream11: 'GAMING',
    'Stitch Internal': 'HR_ADMIN',
};
function normalizeSalaryBand(raw) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    if (/^\d{1,3}$/.test(trimmed))
        return trimmed;
    const nums = [...trimmed.matchAll(/(\d+)/g)].map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 999);
    if (nums.length === 0)
        return null;
    if (nums.length === 1)
        return String(nums[0]);
    return String(Math.round((nums[0] + nums[nums.length - 1]) / 2));
}
function daysFromNow(days) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
}
function daysAgo(days) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - days);
    return d;
}
function requirementExtras(r, timestamp) {
    const workMode = r.workMode ?? 'HYBRID';
    const employmentType = EMPLOYMENT_TYPE_MAP[r.employmentType ?? 'REGULAR'] ?? 'REGULAR';
    const seniorityLevel = SENIORITY_MAP[r.seniorityLevel ?? 'SPECIALIST'] ?? 'SPECIALIST';
    const domain = r.domain ??
        CLIENT_DOMAIN[r.client] ??
        (r.department.toLowerCase().includes('hr') ? 'HR_ADMIN' : 'BANKING_FINANCIAL');
    const jobType = r.jobType ??
        (['HR', 'Product', 'Operations', 'Design'].some((d) => r.department.includes(d)) &&
            !r.primarySkills.some((s) => /Java|React|Node|Kubernetes|SQL|Python|AWS/i.test(s))
            ? 'NON_TECHNICAL'
            : 'TECHNICAL');
    const requirementFor = r.requirementFor ?? 'NEW_POSITION';
    const education = r.education?.length
        ? [...r.education]
        : jobType === 'TECHNICAL'
            ? ['BTECH_BE', 'MCA']
            : ['BACHELORS', 'MBA'];
    const hireCategory = r.hireCategory ??
        (employmentType === 'GRADUATE_HIRE'
            ? 'FRESHER'
            : employmentType === 'CONSULTANT'
                ? 'CONSULTANT'
                : employmentType === 'CONTRACT'
                    ? 'CONTRACT'
                    : 'LATERAL');
    const salaryBand = normalizeSalaryBand(r.salaryBand) ??
        String(Math.max(6, (r.experienceMinYears ?? 4) * 4 + 4));
    const isLive = r.status === 'LIVE';
    const isOnHold = r.status === 'ON_HOLD';
    const isClosed = r.status === 'CLOSED' || r.status === 'CANCELLED';
    // Guarantee no requirement ages at 0 days. For closed/cancelled default to 5,
    // for live/on-hold default to 10, so reports show realistic numbers.
    const defaultAgingDays = isClosed ? 5 : isLive || isOnHold ? 10 : null;
    const liveAgingDays = r.agingDays ?? defaultAgingDays;
    const liveAt = liveAgingDays != null ? daysAgo(liveAgingDays) : null;
    return {
        accountManager: r.accountManager ?? null,
        locationCity: r.locationCity ?? null,
        workMode,
        employmentType,
        seniorityLevel,
        experienceMinYears: r.experienceMinYears ?? null,
        experienceMaxYears: r.experienceMaxYears ?? null,
        salaryBand,
        isRemote: workMode === 'REMOTE',
        liveAt,
        onHoldAt: isOnHold ? timestamp : null,
        closedAt: isClosed ? timestamp : null,
        closureReason: r.status === 'CANCELLED'
            ? 'Cancelled for demo coverage'
            : r.status === 'CLOSED'
                ? 'All positions filled (demo)'
                : null,
        hiringStage: r.hiringStage ?? 'SOURCING',
        businessType: r.businessType ?? (r.client === 'Stitch Internal' ? 'HUMAN_RESOURCE' : 'STAFF_AUGMENTATION'),
        domain,
        jobType,
        employmentChannel: r.employmentChannel ?? (r.client === 'Stitch Internal' ? 'INTERNAL' : 'EXTERNAL'),
        requirementFor,
        replacementEmployeeName: requirementFor === 'REPLACEMENT'
            ? r.replacementEmployeeName ?? 'Outgoing employee'
            : r.replacementEmployeeName ?? null,
        education: JSON.stringify(education),
        hireCategory,
        targetStartDate: r.targetStartDate ? new Date(r.targetStartDate) : daysFromNow(45),
        hiringDeadline: r.hiringDeadline ? new Date(r.hiringDeadline) : daysFromNow(30),
        referralBonusAmount: r.referralBonusAmount != null
            ? r.referralBonusAmount
            : r.visibleToCandidates
                ? Math.round(Number(salaryBand) * 1000)
                : 0,
        visibleToReferrals: Boolean(r.visibleToCandidates),
    };
}
/** Fill every candidate profile field so QA rows never look sparse. */
function completeCandidateFields(data) {
    const yearsMatch = data.totalExperience?.match(/(\d+)/);
    const years = yearsMatch ? Number(yearsMatch[1]) : 4;
    const baseCtc = Math.max(6, years * 3 + 2);
    const slug = data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const hash = [...data.email].reduce((a, c) => a + c.charCodeAt(0), 0);
    const phoneSuffix = String(10000000 + (hash % 89999999)).slice(0, 8);
    const panMid = String(1000 + (hash % 9000));
    const panLetter = String.fromCharCode(65 + (hash % 26));
    return {
        phone: data.phone?.trim() || `+91 98${phoneSuffix.slice(0, 3)} ${phoneSuffix.slice(3)}`,
        location: data.location?.trim() || 'Bengaluru',
        totalExperience: data.totalExperience?.trim() || `${years} Years`,
        currentCompany: data.currentCompany?.trim() || 'Infosys',
        currentCTC: data.currentCTC?.trim() || `${baseCtc} LPA`,
        expectedCTC: data.expectedCTC?.trim() || `${baseCtc + Math.max(3, Math.round(baseCtc * 0.25))} LPA`,
        noticePeriod: data.noticePeriod?.trim() || (years >= 7 ? '90 Days' : years >= 4 ? '60 Days' : '30 Days'),
        pan: (data.pan?.trim() || `ABCP${panLetter}${panMid}${panLetter}`).toUpperCase(),
        linkedIn: data.linkedIn?.trim() || `https://www.linkedin.com/in/${slug}`,
        portfolio: data.portfolio?.trim() || null,
    };
}
async function ensureStageInterview(candidate, stage, opts) {
    const existing = await prisma.interview.findFirst({
        where: { candidateId: candidate.id, planStageId: stage.id },
    });
    if (existing) {
        if (opts.scheduledBy && !existing.scheduledBy) {
            return prisma.interview.update({
                where: { id: existing.id },
                data: { scheduledBy: opts.scheduledBy },
            });
        }
        return existing;
    }
    const interview = await prisma.interview.create({
        data: {
            candidateId: candidate.id,
            requirementId: candidate.requirementId,
            planStageId: stage.id,
            scheduledAt: opts.scheduledAt,
            scheduledBy: opts.scheduledBy ?? null,
            interviewerIds: JSON.stringify([opts.interviewerId]),
            type: stage.interviewType,
            status: opts.status,
            duration: stage.defaultDuration,
            meetingLink: 'https://meet.google.com/demo-stitch-ats',
        },
    });
    const shouldWriteFeedback = opts.withFeedback ?? opts.status === 'COMPLETED';
    if (shouldWriteFeedback) {
        const candidateRow = await prisma.candidate.findUnique({
            where: { id: candidate.id },
            select: { primarySkills: true, secondarySkills: true },
        });
        const skills = [
            ...deserializeSkills(candidateRow?.primarySkills),
            ...deserializeSkills(candidateRow?.secondarySkills),
        ];
        const outcome = opts.feedbackOutcome ?? 'hire';
        const complete = buildCompleteDemoFeedback(skills, outcome);
        await prisma.feedback.create({
            data: {
                interviewId: interview.id,
                interviewerId: opts.interviewerId,
                candidateId: candidate.id,
                rating: complete.rating,
                technicalRating: complete.technicalRating,
                communicationRating: complete.communicationRating,
                comments: complete.comments,
                recommendation: complete.recommendation,
                formData: complete.formData,
            },
        });
    }
    return interview;
}
async function seedInterviewsForCandidate(candidate, progress, interviewerId, scheduledBy) {
    if (!candidate.requirementId)
        return;
    const plan = await ensureInterviewPlan(candidate.requirementId);
    const stages = plan.stages;
    if (stages.length === 0)
        return;
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const failAt = rejectStageIndex(candidate.status);
    // Rejected candidates: only rounds through the failed stage (L1 reject ≠ HR round).
    if (failAt != null) {
        const last = Math.min(failAt, stages.length - 1);
        await prisma.feedback.deleteMany({ where: { candidateId: candidate.id } });
        await prisma.interview.deleteMany({ where: { candidateId: candidate.id } });
        for (let i = 0; i <= last; i++) {
            const outcome = i === last ? 'reject' : 'hire';
            await ensureStageInterview(candidate, stages[i], {
                scheduledAt: new Date(now - (10 - i * 3) * day),
                status: 'COMPLETED',
                interviewerId,
                scheduledBy,
                feedbackOutcome: outcome,
            });
        }
        return;
    }
    const existing = await prisma.interview.findFirst({ where: { candidateId: candidate.id } });
    if (existing) {
        if (scheduledBy && !existing.scheduledBy) {
            await prisma.interview.updateMany({
                where: { candidateId: candidate.id, scheduledBy: null },
                data: { scheduledBy },
            });
        }
        return;
    }
    if (progress === 'l1-scheduled') {
        await ensureStageInterview(candidate, stages[0], {
            scheduledAt: new Date(now + 3 * day),
            status: 'SCHEDULED',
            interviewerId,
            scheduledBy,
            withFeedback: false,
        });
        return;
    }
    if (progress === 'l1-awaiting-feedback') {
        await ensureStageInterview(candidate, stages[0], {
            scheduledAt: new Date(now - 2 * day),
            status: 'COMPLETED',
            interviewerId,
            scheduledBy,
            withFeedback: false,
        });
        return;
    }
    if (progress === 'l1-done-l2-scheduled') {
        await ensureStageInterview(candidate, stages[0], {
            scheduledAt: new Date(now - 5 * day),
            status: 'COMPLETED',
            interviewerId,
            scheduledBy,
            feedbackOutcome: 'hire',
        });
        if (stages[1]) {
            await ensureStageInterview(candidate, stages[1], {
                scheduledAt: new Date(now + 2 * day),
                status: 'SCHEDULED',
                interviewerId,
                scheduledBy,
            });
        }
        return;
    }
    for (let i = 0; i < Math.min(stages.length, 3); i++) {
        await ensureStageInterview(candidate, stages[i], {
            scheduledAt: new Date(now - (10 - i * 3) * day),
            status: 'COMPLETED',
            interviewerId,
            scheduledBy,
            feedbackOutcome: 'hire',
        });
    }
}
async function seedInterviewRounds(candidateSeeds, userByEmail) {
    const interviewerId = userByEmail.get(devUserEmail('INTERVIEWER')) ?? userByEmail.get(devUserEmail('ADMIN'));
    if (!interviewerId)
        return;
    const scheduledBy = userByEmail.get(devUserEmail('RECRUITER')) ?? null;
    const candidates = await prisma.candidate.findMany({
        where: { requirementId: { not: null } },
    });
    for (const c of candidates) {
        const seed = candidateSeeds.get(c.email.toLowerCase());
        const progress = seed?.interviewProgress;
        if (progress) {
            await seedInterviewsForCandidate(c, progress, interviewerId, scheduledBy);
            continue;
        }
        if (c.status === 'L1_INTERVIEW' ||
            c.status === 'MANAGERIAL_INTERVIEW' ||
            c.status === 'CLIENT_INTERVIEW' ||
            c.status === 'HR_INTERVIEW' ||
            c.status === 'INTERVIEW') {
            await seedInterviewsForCandidate(c, 'l1-scheduled', interviewerId, scheduledBy);
        }
    }
}
/** Past interview with no feedback row → UI "Awaiting for feedback". */
async function countAwaitingFeedbackInterviews() {
    const now = new Date();
    const interviews = await prisma.interview.findMany({
        where: { status: { not: 'CANCELLED' } },
        select: { id: true, status: true, scheduledAt: true, duration: true },
    });
    const withFeedback = new Set((await prisma.feedback.findMany({
        where: { interviewId: { in: interviews.map((i) => i.id) } },
        select: { interviewId: true },
    })).map((f) => f.interviewId));
    return interviews.filter((i) => {
        if (withFeedback.has(i.id))
            return false;
        if (i.status === 'COMPLETED')
            return true;
        const end = new Date(i.scheduledAt);
        end.setMinutes(end.getMinutes() + (i.duration ?? 60));
        return end <= now;
    }).length;
}
/**
 * Ensure a handful of interviews sit in the feedback queue.
 * Converts seed-marked awaiting-feedback candidates, then tops up from upcoming SCHEDULED ones.
 */
async function ensureAwaitingFeedbackInterviews(candidateSeeds, interviewerId, target = 5) {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    let awaiting = await countAwaitingFeedbackInterviews();
    const awaitingEmails = [...candidateSeeds.entries()]
        .filter(([, s]) => s.interviewProgress === 'l1-awaiting-feedback')
        .map(([email]) => email);
    for (const email of awaitingEmails) {
        if (awaiting >= target)
            break;
        const candidate = await prisma.candidate.findFirst({
            where: { email: { equals: email, mode: 'insensitive' }, requirementId: { not: null } },
            select: { id: true, email: true, requirementId: true },
        });
        if (!candidate?.requirementId)
            continue;
        const interviews = await prisma.interview.findMany({
            where: { candidateId: candidate.id, status: { not: 'CANCELLED' } },
            orderBy: { scheduledAt: 'asc' },
        });
        if (interviews.length === 0) {
            await seedInterviewsForCandidate(candidate, 'l1-awaiting-feedback', interviewerId);
            awaiting = await countAwaitingFeedbackInterviews();
            continue;
        }
        const first = interviews[0];
        await prisma.feedback.deleteMany({ where: { interviewId: first.id } });
        await prisma.interview.update({
            where: { id: first.id },
            data: {
                scheduledAt: new Date(now - 2 * day),
                status: 'COMPLETED',
                interviewerIds: JSON.stringify([interviewerId]),
            },
        });
        awaiting = await countAwaitingFeedbackInterviews();
    }
    if (awaiting >= target)
        return awaiting;
    const upcoming = await prisma.interview.findMany({
        where: {
            status: 'SCHEDULED',
            scheduledAt: { gt: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        take: target - awaiting,
    });
    for (const iv of upcoming) {
        await prisma.feedback.deleteMany({ where: { interviewId: iv.id } });
        await prisma.interview.update({
            where: { id: iv.id },
            data: {
                scheduledAt: new Date(now - (2 + Math.floor(Math.random() * 3)) * day),
                status: 'COMPLETED',
            },
        });
    }
    return countAwaitingFeedbackInterviews();
}
/**
 * Keep a visible agenda of upcoming SCHEDULED interviews after the feedback-queue
 * step (which can convert upcoming rows into past awaiting-feedback ones).
 */
async function ensureUpcomingInterviews(interviewerIds, target = 5) {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const primaryInterviewer = interviewerIds[0];
    if (!primaryInterviewer)
        return 0;
    let upcoming = await prisma.interview.count({
        where: { status: 'SCHEDULED', scheduledAt: { gt: new Date() } },
    });
    if (upcoming >= target)
        return upcoming;
    const candidates = await prisma.candidate.findMany({
        where: {
            requirementId: { not: null },
            status: {
                in: [
                    'L1_INTERVIEW',
                    'MANAGERIAL_INTERVIEW',
                    'CLIENT_INTERVIEW',
                    'HR_INTERVIEW',
                    'SCREEN_SELECT',
                    'TO_BE_SCREENED',
                ],
            },
        },
        orderBy: { updatedAt: 'desc' },
        take: 30,
    });
    let slot = 0;
    for (const candidate of candidates) {
        if (upcoming >= target)
            break;
        if (!candidate.requirementId)
            continue;
        const existingUpcoming = await prisma.interview.findFirst({
            where: {
                candidateId: candidate.id,
                status: 'SCHEDULED',
                scheduledAt: { gt: new Date() },
            },
        });
        if (existingUpcoming)
            continue;
        const plan = await ensureInterviewPlan(candidate.requirementId);
        const stages = plan.stages;
        if (stages.length === 0)
            continue;
        const completedStageIds = new Set((await prisma.interview.findMany({
            where: {
                candidateId: candidate.id,
                status: 'COMPLETED',
                planStageId: { not: null },
            },
            select: { planStageId: true },
        }))
            .map((row) => row.planStageId)
            .filter(Boolean));
        const stage = stages.find((s) => !completedStageIds.has(s.id)) ?? stages[0];
        const alreadyForStage = await prisma.interview.findFirst({
            where: { candidateId: candidate.id, planStageId: stage.id },
        });
        if (alreadyForStage) {
            if (alreadyForStage.status === 'CANCELLED' ||
                alreadyForStage.scheduledAt <= new Date()) {
                const interviewerId = interviewerIds[slot % interviewerIds.length] ?? primaryInterviewer;
                await prisma.feedback.deleteMany({ where: { interviewId: alreadyForStage.id } });
                await prisma.interview.update({
                    where: { id: alreadyForStage.id },
                    data: {
                        scheduledAt: new Date(now + (1 + slot) * day + 10 * 60 * 60 * 1000),
                        status: 'SCHEDULED',
                        interviewerIds: JSON.stringify(interviewerIds.length > 1
                            ? [interviewerId, interviewerIds[(slot + 1) % interviewerIds.length]].filter((id, idx, arr) => arr.indexOf(id) === idx)
                            : [interviewerId]),
                        meetingLink: alreadyForStage.meetingLink || 'https://meet.google.com/demo-stitch-ats',
                    },
                });
                if (candidate.status !== 'L1_INTERVIEW' &&
                    candidate.status !== 'MANAGERIAL_INTERVIEW' &&
                    candidate.status !== 'CLIENT_INTERVIEW' &&
                    candidate.status !== 'HR_INTERVIEW') {
                    await prisma.candidate.update({
                        where: { id: candidate.id },
                        data: { status: 'L1_INTERVIEW' },
                    });
                }
                upcoming += 1;
                slot += 1;
            }
            continue;
        }
        const interviewerId = interviewerIds[slot % interviewerIds.length] ?? primaryInterviewer;
        const panelPair = interviewerIds.length > 1
            ? [interviewerId, interviewerIds[(slot + 1) % interviewerIds.length]].filter((id, idx, arr) => arr.indexOf(id) === idx)
            : [interviewerId];
        await prisma.interview.create({
            data: {
                candidateId: candidate.id,
                requirementId: candidate.requirementId,
                planStageId: stage.id,
                scheduledAt: new Date(now + (1 + slot) * day + 10 * 60 * 60 * 1000),
                interviewerIds: JSON.stringify(panelPair),
                type: stage.interviewType,
                status: 'SCHEDULED',
                duration: stage.defaultDuration,
                meetingLink: 'https://meet.google.com/demo-stitch-ats',
            },
        });
        if (candidate.status !== 'L1_INTERVIEW' &&
            candidate.status !== 'MANAGERIAL_INTERVIEW' &&
            candidate.status !== 'CLIENT_INTERVIEW' &&
            candidate.status !== 'HR_INTERVIEW') {
            await prisma.candidate.update({
                where: { id: candidate.id },
                data: { status: 'L1_INTERVIEW' },
            });
        }
        upcoming += 1;
        slot += 1;
    }
    return prisma.interview.count({
        where: { status: 'SCHEDULED', scheduledAt: { gt: new Date() } },
    });
}
async function seedDemoChangeRequests(userByEmail) {
    await ensureChangeRequestTable();
    const hr = (await prisma.user.findFirst({
        where: { email: devUserEmail('HR_MANAGER') },
        select: { id: true, name: true, role: true },
    })) ??
        (await prisma.user.findFirst({
            where: { role: 'HR_MANAGER' },
            select: { id: true, name: true, role: true },
        }));
    const admin = (await prisma.user.findFirst({
        where: { email: devUserEmail('ADMIN') },
        select: { id: true, name: true, role: true },
    })) ??
        (await prisma.user.findFirst({
            where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
            select: { id: true, name: true, role: true },
        }));
    let ensured = 0;
    const day = 24 * 60 * 60 * 1000;
    for (const seed of takeAtMostPerKey(DEMO_CHANGE_REQUESTS, (s) => s.status)) {
        const existing = await prisma.changeRequest.findFirst({
            where: { title: seed.title },
            select: { id: true },
        });
        if (existing) {
            ensured++;
            continue;
        }
        const requesterEmail = devUserEmail(seed.requesterRole);
        const requesterId = userByEmail.get(requesterEmail);
        const requester = requesterId
            ? await prisma.user.findUnique({
                where: { id: requesterId },
                select: { id: true, name: true, role: true },
            })
            : await prisma.user.findFirst({
                where: { role: seed.requesterRole },
                select: { id: true, name: true, role: true },
            });
        if (!requester) {
            console.warn(`  Skipping change request "${seed.title}" — no ${seed.requesterRole} user`);
            continue;
        }
        const createdAt = new Date(Date.now() - (seed.daysAgo ?? 2) * day);
        const submittedAt = createdAt.toISOString();
        const history = [
            {
                at: submittedAt,
                action: 'SUBMITTED',
                by: requester.id,
                byName: requester.name,
                byRole: requester.role,
                comment: 'Change request submitted',
            },
        ];
        const data = {
            title: seed.title,
            module: seed.module,
            page: seed.page ?? null,
            description: seed.description,
            status: seed.status,
            requestedBy: requester.id,
            requestedByName: requester.name,
            requestedByRole: requester.role,
            history: '[]',
            createdAt,
            updatedAt: createdAt,
        };
        if (seed.status === 'PENDING_ADMIN' || seed.status === 'CLOSED' || seed.status === 'REJECTED') {
            if (!hr) {
                console.warn(`  Skipping "${seed.title}" — no HR reviewer`);
                continue;
            }
            const hrAt = new Date(createdAt.getTime() + 1 * day);
            data.hrReviewedBy = hr.id;
            data.hrReviewedByName = hr.name;
            data.hrReviewedAt = hrAt;
            data.hrComment = seed.hrComment ?? (seed.status === 'REJECTED' ? 'Rejected after HR review.' : 'Approved by HR.');
            history.push({
                at: hrAt.toISOString(),
                action: seed.status === 'REJECTED' ? 'HR_REJECTED' : 'HR_APPROVED',
                by: hr.id,
                byName: hr.name,
                byRole: hr.role,
                comment: data.hrComment,
            });
        }
        if (seed.status === 'CLOSED') {
            if (!admin) {
                console.warn(`  Skipping "${seed.title}" — no admin closer`);
                continue;
            }
            const closedAt = new Date(createdAt.getTime() + 3 * day);
            data.adminReviewedBy = admin.id;
            data.adminReviewedByName = admin.name;
            data.adminReviewedAt = closedAt;
            data.closedBy = admin.id;
            data.closedByName = admin.name;
            data.closedAt = closedAt;
            data.closureComment = seed.closureComment ?? 'Implemented and closed.';
            data.updatedAt = closedAt;
            history.push({
                at: closedAt.toISOString(),
                action: 'CLOSED',
                by: admin.id,
                byName: admin.name,
                byRole: admin.role,
                comment: data.closureComment,
            });
        }
        if (seed.status === 'REJECTED') {
            data.updatedAt = data.hrReviewedAt ?? createdAt;
        }
        if (seed.status === 'PENDING_ADMIN') {
            data.updatedAt = data.hrReviewedAt ?? createdAt;
        }
        data.history = JSON.stringify(history);
        await prisma.changeRequest.create({ data });
        ensured++;
    }
    return ensured;
}
async function seedOffers(candidateSeeds, recruiterId) {
    const candidates = await prisma.candidate.findMany({
        where: {
            status: {
                in: [
                    'TO_BE_OFFERED',
                    'OFFERED',
                    'OFFER_ACCEPTED',
                    'OFFER_DECLINED',
                    'JOINED',
                    'OFFER',
                    'HIRED',
                ],
            },
            requirementId: { not: null },
        },
    });
    for (const c of candidates) {
        const existing = await prisma.offer.findFirst({ where: { candidateId: c.id } });
        if (existing)
            continue;
        const seed = candidateSeeds.get(c.email.toLowerCase());
        const rawOfferStatus = seed?.offerStatus ??
            (c.status === 'OFFER_DECLINED'
                ? 'DECLINED'
                : c.status === 'TO_BE_OFFERED' || c.status === 'OFFERED' || c.status === 'OFFER'
                    ? 'SENT'
                    : 'ACCEPTED');
        const status = rawOfferStatus === 'PENDING' ? 'DRAFT' : rawOfferStatus;
        const role = (c.role ?? '').toLowerCase();
        const baseSalary = role.includes('design')
            ? 2_200_000
            : role.includes('devops') || role.includes('sre') || role.includes('platform')
                ? 2_600_000
                : role.includes('product manager')
                    ? 3_000_000
                    : role.includes('analyst') || role.includes('data')
                        ? 1_800_000
                        : 2_800_000;
        const nowIso = new Date().toISOString();
        const history = [
            { action: 'CREATED', at: nowIso, by: recruiterId },
        ];
        if (status === 'PENDING_HR_APPROVAL' ||
            status === 'PENDING_EXEC_APPROVAL' ||
            status === 'PENDING_APPROVAL' ||
            status === 'APPROVED' ||
            status === 'SENT' ||
            status === 'NEGOTIATION' ||
            status === 'ACCEPTED' ||
            status === 'DECLINED' ||
            status === 'WITHDRAWN') {
            history.push({ action: 'SUBMITTED_FOR_APPROVAL', at: nowIso, by: recruiterId });
        }
        if (status === 'APPROVED' || status === 'SENT' || status === 'NEGOTIATION' || status === 'ACCEPTED' || status === 'DECLINED') {
            history.push({ action: 'APPROVED', at: nowIso, by: recruiterId });
        }
        if (status === 'SENT' || status === 'NEGOTIATION' || status === 'ACCEPTED' || status === 'DECLINED') {
            history.push({ action: 'SENT', at: nowIso, by: recruiterId });
        }
        if (status === 'NEGOTIATION') {
            history.push({ action: 'NEGOTIATION', at: nowIso, by: c.id });
        }
        if (status === 'ACCEPTED') {
            history.push({ action: 'ACCEPTED', at: nowIso, by: c.id });
        }
        if (status === 'DECLINED') {
            history.push({ action: 'DECLINED', at: nowIso, by: c.id });
        }
        if (status === 'WITHDRAWN') {
            history.push({ action: 'WITHDRAWN', at: nowIso, by: recruiterId });
        }
        const sentLike = ['SENT', 'NEGOTIATION', 'ACCEPTED', 'DECLINED'].includes(status);
        const respondedLike = ['ACCEPTED', 'DECLINED'].includes(status);
        await prisma.offer.create({
            data: {
                candidateId: c.id,
                requirementId: c.requirementId,
                baseSalary,
                annualCtc: baseSalary,
                bonus: status === 'DECLINED' && role.includes('devops') ? null : 200_000,
                status,
                createdBy: recruiterId,
                history: JSON.stringify(history),
                ...(sentLike
                    ? {
                        sentAt: new Date(Date.now() - 10 * 86400000),
                        validUntil: new Date(Date.now() + 14 * 86400000),
                    }
                    : {}),
                ...(respondedLike ? { respondedAt: new Date(Date.now() - 3 * 86400000) } : {}),
            },
        });
    }
}
async function seedClientDeals(userByEmail, recruiterId) {
    const accountManagerId = userByEmail.get(devUserEmail('ACCOUNT_MANAGER')) ?? recruiterId;
    const hiringManagerId = userByEmail.get(devUserEmail('HIRING_MANAGER')) ?? recruiterId;
    let ensured = 0;
    for (const deal of takeAtMostPerKey(DEMO_CLIENT_DEALS, (d) => d.businessStage)) {
        const percentage = businessStagePercentage(deal.businessStage);
        const timestamp = new Date().toISOString();
        const payload = {
            client: deal.client,
            accountManager: accountManagerId,
            hiringManager: hiringManagerId,
            notes: deal.notes,
            businessStage: deal.businessStage,
            stagePercentage: percentage,
            sowGatewayReached: false,
            status: 'ACTIVE',
            createdBy: recruiterId,
            createdByRole: 'RECRUITER',
            stageHistory: JSON.stringify([
                {
                    stage: deal.businessStage,
                    percentage,
                    by: recruiterId,
                    at: timestamp,
                    role: 'RECRUITER',
                },
            ]),
        };
        const existing = await prisma.clientDeal.findFirst({ where: { client: deal.client } });
        const row = existing
            ? await prisma.clientDeal.update({ where: { id: existing.id }, data: payload })
            : await prisma.clientDeal.create({ data: payload });
        ensured += 1;
        const linked = deal.linkedRequirement;
        if (!linked)
            continue;
        const linkedPct = linkedRequirementStagePercentage(linked.businessStage);
        const brPayload = {
            clientDealId: row.id,
            title: linked.title,
            client: deal.client,
            department: linked.department,
            accountManager: accountManagerId,
            hiringManager: hiringManagerId,
            businessStage: linked.businessStage,
            stagePercentage: linkedPct,
            status: 'ACTIVE',
            openings: linked.openings,
            priority: linked.priority,
            location: linked.location,
            workMode: linked.workMode,
            employmentType: linked.employmentType,
            seniorityLevel: linked.seniorityLevel,
            experienceMinYears: linked.experienceMinYears,
            experienceMaxYears: linked.experienceMaxYears,
            salaryBand: linked.salaryBand,
            isRemote: linked.workMode === 'REMOTE',
            description: linked.description,
            jobDescription: linked.jobDescription,
            primarySkills: serializeSkills([...linked.primarySkills]),
            secondarySkills: serializeSkills([...linked.secondarySkills]),
            createdBy: recruiterId,
            createdByRole: 'RECRUITER',
            stageHistory: JSON.stringify([
                {
                    stage: linked.businessStage,
                    percentage: linkedPct,
                    by: recruiterId,
                    at: timestamp,
                    role: 'RECRUITER',
                },
            ]),
        };
        const existingBr = await prisma.businessRequirement.findFirst({
            where: { title: linked.title, client: deal.client },
        });
        if (existingBr) {
            await prisma.businessRequirement.update({ where: { id: existingBr.id }, data: brPayload });
        }
        else {
            await prisma.businessRequirement.create({ data: brPayload });
        }
    }
    return ensured;
}
async function linkDemoReferrals(candidateSeeds, userByEmail) {
    const employeeId = userByEmail.get(devUserEmail('EMPLOYEE'));
    const recruiterId = userByEmail.get(devUserEmail('RECRUITER'));
    if (!employeeId && !recruiterId)
        return 0;
    let linked = 0;
    for (const [email, seed] of candidateSeeds) {
        if (!seed.referredByRole && !/referral/i.test(seed.source))
            continue;
        const referrerId = seed.referredByRole === 'RECRUITER'
            ? recruiterId
            : employeeId ?? recruiterId;
        if (!referrerId)
            continue;
        const row = await findCandidateByEmail(email);
        if (!row)
            continue;
        await prisma.candidate.update({
            where: { id: row.id },
            data: {
                referredByUserId: referrerId,
                referralRelationship: seed.referralRelationship ?? 'Employee referral',
                referralNotes: seed.referralNotes ?? `Demo referral via ${seed.source}`,
                source: seed.source.includes('Referral') ? seed.source : 'Employee Referral',
            },
        });
        linked += 1;
    }
    return linked;
}
async function seedDemoActivityTour(userByEmail, recruiterId) {
    const actor = userByEmail.get(devUserEmail('HR_MANAGER')) ??
        userByEmail.get(devUserEmail('ADMIN')) ??
        recruiterId;
    const actorUser = await prisma.user.findUnique({ where: { id: actor } });
    const performerName = actorUser?.name ?? 'Demo Admin';
    const performerRole = actorUser?.role ?? 'ADMIN';
    const sampleCandidate = await prisma.candidate.findFirst({
        where: { email: { endsWith: '@stitch-ats.in' }, requirementId: { not: null } },
        orderBy: { updatedAt: 'desc' },
    });
    const sampleReq = await prisma.requirement.findFirst({
        where: { jobCode: { startsWith: 'REQ' } },
        orderBy: { updatedAt: 'desc' },
    });
    const sampleOffer = await prisma.offer.findFirst({ orderBy: { createdAt: 'desc' } });
    const sampleInterview = await prisma.interview.findFirst({ orderBy: { scheduledAt: 'desc' } });
    const events = [];
    if (sampleCandidate) {
        events.push({
            entityType: 'CANDIDATE',
            entityId: sampleCandidate.id,
            action: 'STATUS_CHANGED',
            details: {
                from: 'TO_BE_SCREENED',
                to: sampleCandidate.status,
                via: 'seed-coverage',
            },
        });
    }
    if (sampleReq) {
        events.push({
            entityType: 'REQUIREMENT',
            entityId: sampleReq.id,
            action: 'UPDATED',
            details: { jobCode: sampleReq.jobCode, title: sampleReq.title, via: 'seed-coverage' },
        });
    }
    if (sampleInterview) {
        events.push({
            entityType: 'INTERVIEW',
            entityId: sampleInterview.id,
            action: 'SCHEDULED',
            details: { status: sampleInterview.status, via: 'seed-coverage' },
        });
    }
    if (sampleOffer) {
        events.push({
            entityType: 'OFFER',
            entityId: sampleOffer.id,
            action: sampleOffer.status === 'ACCEPTED' ? 'ACCEPTED' : 'CREATED',
            details: { status: sampleOffer.status, via: 'seed-coverage' },
        });
    }
    let written = 0;
    for (const event of events) {
        const existing = await prisma.activityLog.findFirst({
            where: {
                entityType: event.entityType,
                entityId: event.entityId,
                action: event.action,
                performedBy: actor,
            },
        });
        if (existing)
            continue;
        await logActivity({
            entityType: event.entityType,
            entityId: event.entityId,
            action: event.action,
            performedBy: actor,
            performerName,
            performerRole,
            details: event.details,
            seed: true,
        });
        written += 1;
    }
    return written;
}
async function syncRequirementFilledCounts(reqByCode) {
    for (const [, req] of reqByCode) {
        const filled = await prisma.candidate.count({
            where: { requirementId: req.id, status: { in: ['JOINED', 'HIRED'] } },
        });
        await prisma.requirement.update({ where: { id: req.id }, data: { filled } });
    }
}
function deriveMonthQuarter(isoDate) {
    const d = new Date(`${isoDate}T12:00:00`);
    if (Number.isNaN(d.getTime()))
        return { joiningMonth: '', joiningQuarter: '' };
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const q = Math.floor(d.getMonth() / 3) + 1;
    return { joiningMonth: `${year}-${month}`, joiningQuarter: `Q${q} ${year}` };
}
/**
 * Ensure every JOINED/HIRED candidate has a joiningDate, joiningMonth,
 * joiningQuarter, and joinedEmployeeId so the Requirement Details page
 * shows Employee ID + Date of joining for seeded hires.
 */
async function backfillJoinedCandidateData() {
    const joined = await prisma.candidate.findMany({
        where: { status: { in: ['JOINED', 'HIRED'] } },
        select: {
            id: true,
            name: true,
            email: true,
            joiningDate: true,
            joiningMonth: true,
            joiningQuarter: true,
        },
    });
    if (joined.length === 0)
        return 0;
    // Spread joining dates across the last ~60 days so reports look lived-in.
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    let updated = 0;
    for (let i = 0; i < joined.length; i++) {
        const c = joined[i];
        if (c.joiningDate)
            continue;
        // Deterministic per-candidate offset so re-seeds stay stable.
        const hash = [...c.email].reduce((a, ch) => a + ch.charCodeAt(0), 0);
        const daysAgo = 5 + (hash % 55); // 5–60 days ago
        const joiningDate = new Date(now - daysAgo * day);
        const iso = joiningDate.toISOString().slice(0, 10);
        const { joiningMonth, joiningQuarter } = deriveMonthQuarter(iso);
        // Stable employee ID seeded from email hash.
        const empDigits = String(10000 + (hash % 89999));
        const employeeId = `ST${empDigits}`;
        await prisma.candidate.update({
            where: { id: c.id },
            data: {
                joiningDate,
                joiningMonth,
                joiningQuarter,
            },
        });
        // Mirror the employee ID onto the requirement's joinedEmployeeId
        // so the Requirement Detail "Employee ID" field shows it.
        const candidate = await prisma.candidate.findUnique({
            where: { id: c.id },
            select: { requirementId: true, joiningDate: true },
        });
        if (candidate?.requirementId) {
            await prisma.requirement.update({
                where: { id: candidate.requirementId },
                data: {
                    joinedEmployeeId: employeeId,
                    joinedEmployeeName: c.name,
                    joiningDate: candidate.joiningDate ?? joiningDate,
                },
            });
        }
        updated += 1;
    }
    return updated;
}
async function ensurePortalApplicationLog(candidateId, userId, requirement, userName) {
    const logs = await prisma.activityLog.findMany({
        where: {
            entityType: 'CANDIDATE',
            entityId: candidateId,
            action: 'APPLIED',
        },
    });
    const already = logs.some((l) => {
        try {
            const d = JSON.parse(l.details || '{}');
            return d.requirementId === requirement.id;
        }
        catch {
            return false;
        }
    });
    if (already)
        return;
    await logActivity({
        entityType: 'CANDIDATE',
        entityId: candidateId,
        action: 'APPLIED',
        performedBy: userId,
        performerName: userName,
        performerRole: 'CANDIDATE',
        details: {
            requirementId: requirement.id,
            jobCode: requirement.jobCode,
            title: requirement.title,
            via: 'seed',
        },
        seed: true,
    });
}
async function clearHiringData() {
    console.log('Clearing existing hiring data...');
    await prisma.$transaction([
        prisma.activityLog.deleteMany(),
        prisma.feedback.deleteMany(),
        prisma.offer.deleteMany(),
        prisma.interview.deleteMany(),
        prisma.interviewPlan.deleteMany(),
        prisma.candidate.deleteMany(),
        prisma.vendorRequirement.deleteMany(),
        prisma.businessRequirement.deleteMany(),
        prisma.clientDeal.deleteMany(),
        prisma.requirement.deleteMany(),
        prisma.changeRequest.deleteMany(),
    ]);
}
/** Delete surplus candidates so each pipeline status stays ≤ DEMO_MAX_PER_STAGE. */
async function enforceCandidateStageCaps() {
    for (const status of [
        'TO_BE_SCREENED',
        'SCREEN_SELECT',
        'SCREEN_REJECT',
        'L1_INTERVIEW',
        'L1_INTERVIEW_REJECT',
        'MANAGERIAL_INTERVIEW',
        'MANAGERIAL_INTERVIEW_REJECT',
        'CLIENT_INTERVIEW',
        'CLIENT_INTERVIEW_REJECT',
        'HR_INTERVIEW',
        'HR_INTERVIEW_SELECT',
        'HR_INTERVIEW_REJECT',
        'TO_BE_OFFERED',
        'OFFERED',
        'OFFER_ACCEPTED',
        'POSITION_ABORT',
        'OFFER_DECLINED',
        'CANDIDATE_ABORT',
        'JOINED',
        'BANK',
        'ON_HOLD',
    ]) {
        const rows = await prisma.candidate.findMany({
            where: { status },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        });
        if (rows.length <= DEMO_MAX_PER_STAGE)
            continue;
        const dropIds = rows.slice(DEMO_MAX_PER_STAGE).map((r) => r.id);
        await prisma.feedback.deleteMany({ where: { candidateId: { in: dropIds } } });
        await prisma.offer.deleteMany({ where: { candidateId: { in: dropIds } } });
        await prisma.interview.deleteMany({ where: { candidateId: { in: dropIds } } });
        await prisma.activityLog.deleteMany({
            where: { entityType: 'CANDIDATE', entityId: { in: dropIds } },
        });
        await prisma.candidate.deleteMany({ where: { id: { in: dropIds } } });
    }
}
async function upsertUser(u) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    return prisma.user.upsert({
        where: { email: u.email.toLowerCase() },
        update: {
            name: u.name,
            role: u.role,
            department: u.department,
            passwordHash,
            status: 'ACTIVE',
            ...(u.vendorId !== undefined && { vendorId: u.vendorId }),
        },
        create: {
            email: u.email.toLowerCase(),
            passwordHash,
            name: u.name,
            role: u.role,
            department: u.department,
            status: 'ACTIVE',
            permissions: '[]',
            themePreference: 'light',
            authProvider: 'local',
            ...(u.vendorId !== undefined && { vendorId: u.vendorId }),
        },
    });
}
async function attachResume(candidateId, data) {
    const textPayload = buildCandidateResumePayload(data.snippet);
    const primarySkills = data.primarySkills?.length
        ? serializeSkills(data.primarySkills)
        : textPayload.primarySkills;
    const secondarySkills = data.secondarySkills?.length
        ? serializeSkills(data.secondarySkills)
        : textPayload.secondarySkills;
    const fileName = demoResumeFileName(data.name);
    let resumeText = textPayload.resumeText;
    try {
        const buffer = await renderDemoCandidateResumePdf({
            name: data.name,
            email: data.email,
            role: data.role,
            location: data.location,
            summary: data.snippet,
            primarySkills: data.primarySkills,
            secondarySkills: data.secondarySkills,
        });
        try {
            const parsed = await extractResumeText(buffer, 'application/pdf', fileName);
            const merged = [data.snippet, parsed].filter(Boolean).join('\n\n');
            const mergedPayload = buildCandidateResumePayload(merged);
            resumeText = mergedPayload.resumeText;
        }
        catch {
            // keep snippet-based resume text
        }
        await saveResumeFile(candidateId, 'application/pdf', buffer, fileName);
        await prisma.candidate.update({
            where: { id: candidateId },
            data: {
                resumeFileName: fileName,
                resumeMimeType: 'application/pdf',
                resumeUrl: null,
                resumeStorageKey: null,
                resumeText,
                primarySkills: data.primarySkills?.length ? primarySkills : textPayload.primarySkills,
                secondarySkills: data.secondarySkills?.length ? secondarySkills : textPayload.secondarySkills,
            },
        });
    }
    catch (err) {
        console.warn(`Could not generate resume PDF for ${data.email}:`, err);
        await prisma.candidate.update({
            where: { id: candidateId },
            data: {
                resumeFileName: fileName,
                resumeMimeType: 'application/pdf',
                resumeUrl: null,
                resumeText,
                primarySkills,
                secondarySkills,
            },
        });
    }
}
function demoVendorOnboardingForm(legalName, email, contactName) {
    const form = emptyOnboardingForm();
    return {
        ...form,
        legalName,
        email,
        primaryContactName: contactName,
        designation: 'Managing Partner',
        contactNumber: '+91 98765 00000',
        website: 'https://example.com',
        registeredAddress: 'Demo address, India',
        yearOfIncorporation: '2015',
        totalEmployees: '120',
        primaryServiceOfferings: 'IT staffing, contract hiring',
        coreServiceCapabilities: 'Full-stack engineering, QA, data',
        domainIndustryExperience: 'BFSI, SaaS, e-commerce',
        certifications: 'ISO 27001',
        deliveryModel: 'Hybrid onsite / remote',
        qualityAssuranceProcesses: 'Weekly QA audits',
        slaKpiManagement: '48h CV turnaround SLA',
        escalationGovernance: 'Named account manager + weekly reviews',
        engagementTypes: ['FULLTIME', 'CONTRACT'],
        nda: true,
        dataSecurityPrivacy: true,
        statutoryLegal: true,
        businessContinuity: true,
        informationSecurity: true,
        references: [
            {
                clientName: 'Demo Client A',
                industry: 'Fintech',
                engagementSummary: 'Placed 12 engineers in 2025',
                contact: 'hm@democlient.example.com',
            },
            {
                clientName: 'Demo Client B',
                industry: 'SaaS',
                engagementSummary: 'Contract bench for product squads',
                contact: 'ta@democlient.example.com',
            },
            { clientName: '', industry: '', engagementSummary: '', contact: '' },
        ],
    };
}
function demoVendorEvaluationScores() {
    const scores = emptyEvaluationScores();
    for (const key of Object.keys(scores)) {
        scores[key] = { fulltime: 4, contract: 4 };
    }
    return scores;
}
async function upsertDemoVendorOnboarding(vendorId, legalName, email, contactName, status) {
    const now = new Date();
    const onboardingJson = JSON.stringify(demoVendorOnboardingForm(legalName, email, contactName));
    const evaluationJson = JSON.stringify(demoVendorEvaluationScores());
    const submitted = status === 'SUBMITTED' || status === 'APPROVED' || status === 'REJECTED';
    const decided = status === 'APPROVED' || status === 'REJECTED';
    await prisma.vendorOnboarding.upsert({
        where: { vendorId },
        update: {
            status,
            onboardingJson,
            evaluationJson,
            onboardingCompletedAt: status === 'NOT_STARTED' ? null : status === 'ONBOARDING' ? null : now,
            evaluationCompletedAt: status === 'EVALUATION' || status === 'SUBMITTED' || decided ? now : null,
            submittedAt: submitted ? now : null,
            submittedBy: submitted ? 'demo-seed' : null,
            overallPercentage: decided || status === 'SUBMITTED' ? 80 : null,
            category: decided || status === 'SUBMITTED' ? 'APPROVED' : null,
            decisionReason: decided
                ? status === 'APPROVED'
                    ? 'Demo seed — approved for portal use'
                    : 'Demo seed — rejected for coverage'
                : null,
            decidedAt: decided ? now : null,
            decidedByName: decided ? 'Demo Admin' : null,
            decidedByRole: decided ? 'ADMIN' : null,
        },
        create: {
            vendorId,
            status,
            onboardingJson,
            evaluationJson,
            onboardingCompletedAt: status === 'NOT_STARTED' || status === 'ONBOARDING' ? null : now,
            evaluationCompletedAt: status === 'EVALUATION' || status === 'SUBMITTED' || decided ? now : null,
            submittedAt: submitted ? now : null,
            submittedBy: submitted ? 'demo-seed' : null,
            overallPercentage: decided || status === 'SUBMITTED' ? 80 : null,
            category: decided || status === 'SUBMITTED' ? 'APPROVED' : null,
            decisionReason: decided
                ? status === 'APPROVED'
                    ? 'Demo seed — approved for portal use'
                    : 'Demo seed — rejected for coverage'
                : null,
            decidedAt: decided ? now : null,
            decidedByName: decided ? 'Demo Admin' : null,
            decidedByRole: decided ? 'ADMIN' : null,
        },
    });
}
async function main() {
    if (env.isProduction && !FORCE) {
        console.error('Refusing to seed demo data in production. Pass --force to override.');
        process.exit(1);
    }
    if (FRESH && !FORCE) {
        const host = process.env.DATABASE_URL ?? '';
        const looksProduction = host.includes('weathered-math') ||
            process.env.RENDER === 'true' ||
            process.env.NODE_ENV === 'production';
        if (looksProduction) {
            console.error('Refusing --fresh wipe on a production database.\n' +
                'Use a local or QA staging DATABASE_URL, or pass --force if you truly intend to wipe this DB.');
            process.exit(1);
        }
    }
    if (FRESH)
        await clearHiringData();
    const legacyCleanup = await removeLegacyDevUsers(prisma);
    const legacyRemoved = legacyCleanup.merged + legacyCleanup.deleted + legacyCleanup.patternDeleted;
    if (legacyRemoved > 0) {
        console.log(`Removed ${legacyRemoved} legacy user(s) (merged ${legacyCleanup.merged}, deleted ${legacyCleanup.deleted + legacyCleanup.patternDeleted}).`);
    }
    console.log('Seeding catalogs (skills, departments, clients, cities, market trends)...');
    await ensureDefaultSkillCatalog();
    await ensureDefaultDepartmentCatalog();
    await ensureDefaultClientCatalog();
    await ensureDefaultCityCatalog();
    await ensureMarketTrendsTables();
    await prisma.clientCatalog.createMany({
        data: DEMO_CLIENT_NAMES.map((name) => ({ name })),
        skipDuplicates: true,
    });
    console.log('Seeding demo users...');
    const vendor = await prisma.vendor.upsert({
        where: { code: DEMO_VENDOR_CODE },
        update: {
            name: DEMO_VENDOR_NAME,
            status: 'ACTIVE',
            email: 'staffing@stitch-ats.in',
            contactName: 'Raghavendra Murthy',
            phone: '+91 80 4123 8900',
            website: 'https://talentbridge.example.com',
            address: 'Manyata Tech Park, Bengaluru, Karnataka 560045',
            notes: 'Primary IT staffing partner for fintech and product accounts.',
        },
        create: {
            name: DEMO_VENDOR_NAME,
            code: DEMO_VENDOR_CODE,
            email: 'staffing@stitch-ats.in',
            status: 'ACTIVE',
            contactName: 'Raghavendra Murthy',
            phone: '+91 80 4123 8900',
            website: 'https://talentbridge.example.com',
            address: 'Manyata Tech Park, Bengaluru, Karnataka 560045',
            notes: 'Primary IT staffing partner for fintech and product accounts.',
        },
    });
    const EXTRA_VENDORS = [
        {
            code: 'APEX',
            name: 'Apex Talent Partners',
            email: 'contact@apextalent.example.com',
            phone: '+91 98765 43210',
            contactName: 'Priya Sharma',
            website: 'https://apextalent.example.com',
            address: 'HITEC City, Hyderabad, Telangana 500081',
            notes: 'IT staffing — Bengaluru & Hyderabad.',
            onboardingStatus: 'SUBMITTED',
        },
        {
            code: 'NEXUS',
            name: 'Nexus Recruit Solutions',
            email: 'hello@nexusrecruit.example.com',
            phone: '+91 91234 56789',
            contactName: 'Rahul Mehta',
            website: 'https://nexusrecruit.example.com',
            address: 'Bandra Kurla Complex, Mumbai, Maharashtra 400051',
            notes: 'Finance, product, and analytics roles.',
            onboardingStatus: 'SUBMITTED',
        },
        {
            code: 'HORIZON',
            name: 'Horizon Staffing Co',
            email: 'ops@horizonstaff.example.com',
            phone: '+91 99887 76655',
            contactName: 'Anita Desai',
            website: 'https://horizonstaff.example.com',
            address: 'Sector 44, Gurugram, Haryana 122003',
            notes: 'Contract and permanent hiring across NCR.',
            onboardingStatus: 'SUBMITTED',
        },
        {
            code: 'PULSE',
            name: 'Pulse Hire Collective',
            email: 'team@pulsehire.example.com',
            phone: '+91 98111 22334',
            contactName: 'Kiran Shetty',
            website: 'https://pulsehire.example.com',
            address: 'Koramangala, Bengaluru, Karnataka 560034',
            notes: 'Mid-market product engineering staffing.',
            onboardingStatus: 'EVALUATION',
        },
        {
            code: 'SUMMIT',
            name: 'Summit People Partners',
            email: 'hello@summitpeople.example.com',
            phone: '+91 99001 12233',
            contactName: 'Meera Iyer',
            website: 'https://summitpeople.example.com',
            address: 'Salt Lake, Kolkata, West Bengal 700091',
            notes: 'Eastern India coverage for tech and shared services.',
            onboardingStatus: 'ONBOARDING',
        },
        {
            code: 'REJECTCO',
            name: 'RejectCo Staffing Demo',
            email: 'ops@rejectco.example.com',
            phone: '+91 90000 11122',
            contactName: 'Demo Reject',
            website: 'https://rejectco.example.com',
            address: 'Demo address',
            notes: 'Seeded rejected onboarding packet.',
            onboardingStatus: 'REJECTED',
        },
    ];
    for (const v of EXTRA_VENDORS) {
        const { onboardingStatus, ...vendorFields } = v;
        const row = await prisma.vendor.upsert({
            where: { code: v.code },
            update: { ...vendorFields, status: 'ACTIVE' },
            create: { ...vendorFields, status: 'ACTIVE' },
        });
        await upsertDemoVendorOnboarding(row.id, v.name, v.email, v.contactName, onboardingStatus);
    }
    // Primary demo vendor is fully approved for portal walkthroughs.
    await upsertDemoVendorOnboarding(vendor.id, DEMO_VENDOR_NAME, 'staffing@stitch-ats.in', 'Raghavendra Murthy', 'APPROVED');
    const userByEmail = new Map();
    for (const u of DEV_USERS) {
        const row = await upsertUser({
            ...u,
            vendorId: u.role === 'VENDOR' ? vendor.id : undefined,
        });
        userByEmail.set(row.email, row.id);
    }
    for (const u of DEMO_PORTAL_USERS.slice(0, DEMO_MAX_PER_STAGE)) {
        const row = await upsertUser({
            email: u.email,
            password: u.password,
            name: u.name,
            role: 'CANDIDATE',
        });
        userByEmail.set(row.email, row.id);
    }
    const recruiterId = userByEmail.get(devUserEmail('RECRUITER')) ?? userByEmail.get(devUserEmail('ADMIN'));
    const jobCodeMigration = await migrateRequirementJobCodes();
    if (jobCodeMigration.updated > 0) {
        console.log(`Migrated ${jobCodeMigration.updated} requirement job code(s) to REQ format.`);
    }
    console.log('Seeding requirements (≤3 per posting status)...');
    const reqByCode = new Map();
    const allRequirements = takeAtMostPerKey([...DEMO_COVERAGE_REQUIREMENTS, ...DEMO_REQUIREMENTS], (r) => r.status);
    for (const r of allRequirements) {
        const timestamp = new Date();
        const approvalDecision = r.status === 'LIVE' || r.status === 'ON_HOLD' || r.status === 'CLOSED'
            ? 'APPROVED'
            : r.status === 'REJECTED'
                ? 'REJECTED'
                : 'PENDING';
        const row = await prisma.requirement.upsert({
            where: { jobCode: r.jobCode },
            update: {
                title: r.title,
                department: r.department,
                hiringManager: r.hiringManager,
                client: r.client,
                location: r.location,
                priority: r.priority,
                openings: r.openings,
                filled: r.filled,
                status: r.status,
                description: r.description,
                jobDescription: r.jobDescription,
                primarySkills: serializeSkills([...r.primarySkills]),
                secondarySkills: serializeSkills([...r.secondarySkills]),
                visibleToCandidates: r.visibleToCandidates,
                visibleToVendors: r.visibleToVendors,
                ...requirementExtras(r, timestamp),
                approval: JSON.stringify({ decision: approvalDecision }),
            },
            create: {
                jobCode: r.jobCode,
                title: r.title,
                department: r.department,
                hiringManager: r.hiringManager,
                client: r.client,
                location: r.location,
                priority: r.priority,
                openings: r.openings,
                filled: r.filled,
                status: r.status,
                description: r.description,
                jobDescription: r.jobDescription,
                primarySkills: serializeSkills([...r.primarySkills]),
                secondarySkills: serializeSkills([...r.secondarySkills]),
                visibleToCandidates: r.visibleToCandidates,
                visibleToVendors: r.visibleToVendors,
                ...requirementExtras(r, timestamp),
                createdBy: recruiterId,
                createdByRole: 'RECRUITER',
                recruiters: JSON.stringify([recruiterId]),
                approval: JSON.stringify({ decision: approvalDecision }),
                approvalHistory: JSON.stringify([
                    {
                        action: approvalDecision === 'APPROVED' ? 'APPROVED' : approvalDecision === 'REJECTED' ? 'REJECTED' : 'REQUESTED',
                        by: recruiterId,
                        at: timestamp.toISOString(),
                        role: 'RECRUITER',
                    },
                ]),
                versions: '[]',
                currentVersion: 1,
            },
        });
        reqByCode.set(r.jobCode, { id: row.id, title: row.title });
        await ensureInterviewPlan(row.id);
        if (r.visibleToVendors) {
            await prisma.vendorRequirement.upsert({
                where: {
                    vendorId_requirementId: {
                        vendorId: vendor.id,
                        requirementId: row.id,
                    },
                },
                update: {},
                create: {
                    vendorId: vendor.id,
                    requirementId: row.id,
                    assignedBy: recruiterId,
                },
            });
        }
    }
    console.log('Seeding client deals + linked business requirements...');
    const clientDealsSeeded = await seedClientDeals(userByEmail, recruiterId);
    console.log(`Client deals: ${clientDealsSeeded}`);
    console.log('Seeding business requirements (≤3 per business stage)...');
    const allBusinessRequirements = takeAtMostPerKey([...DEMO_COVERAGE_BUSINESS_REQUIREMENTS, ...DEMO_BUSINESS_REQUIREMENTS], (br) => br.businessStage);
    for (const br of allBusinessRequirements) {
        const accountManagerId = userByEmail.get(devUserEmail(br.accountManagerRole));
        const hiringManagerId = userByEmail.get(devUserEmail(br.hiringManagerRole));
        const stage = br.businessStage;
        const percentage = businessStagePercentage(stage);
        const timestamp = new Date().toISOString();
        const payload = {
            title: br.title,
            client: br.client,
            department: br.department,
            accountManager: accountManagerId,
            hiringManager: hiringManagerId,
            businessStage: stage,
            stagePercentage: percentage,
            status: 'ACTIVE',
            openings: br.openings,
            priority: br.priority,
            location: br.location,
            locationCity: br.locationCity ?? null,
            workMode: br.workMode,
            employmentType: EMPLOYMENT_TYPE_MAP[br.employmentType] ?? br.employmentType,
            seniorityLevel: SENIORITY_MAP[br.seniorityLevel] ?? br.seniorityLevel,
            experienceMinYears: br.experienceMinYears,
            experienceMaxYears: br.experienceMaxYears,
            salaryBand: normalizeSalaryBand(br.salaryBand) ?? br.salaryBand,
            isRemote: br.workMode === 'REMOTE',
            description: br.description,
            jobDescription: br.jobDescription,
            primarySkills: serializeSkills([...br.primarySkills]),
            secondarySkills: serializeSkills([...br.secondarySkills]),
            createdBy: recruiterId,
            createdByRole: 'RECRUITER',
            stageHistory: JSON.stringify([
                { stage, percentage, by: recruiterId, at: timestamp, role: 'RECRUITER' },
            ]),
        };
        const existing = await prisma.businessRequirement.findFirst({
            where: { title: br.title, client: br.client },
        });
        if (existing) {
            await prisma.businessRequirement.update({ where: { id: existing.id }, data: payload });
        }
        else {
            await prisma.businessRequirement.create({ data: payload });
        }
    }
    const vendorUserId = userByEmail.get(devUserEmail('VENDOR'));
    async function upsertCandidate(data) {
        const requirement = data.jobCode ? reqByCode.get(data.jobCode) : undefined;
        const skillsPayload = buildCandidateResumePayload(data.resumeSnippet);
        const profile = completeCandidateFields(data);
        const payload = {
            name: data.name,
            role: data.role,
            status: data.status,
            source: data.source,
            requirementId: requirement?.id ?? null,
            jobTitle: requirement?.title ?? data.role,
            phone: profile.phone,
            location: profile.location,
            totalExperience: profile.totalExperience,
            currentCompany: profile.currentCompany,
            currentCTC: profile.currentCTC,
            expectedCTC: profile.expectedCTC,
            noticePeriod: profile.noticePeriod,
            pan: profile.pan,
            linkedIn: profile.linkedIn,
            portfolio: profile.portfolio,
            primarySkills: data.primarySkills
                ? serializeSkills(data.primarySkills)
                : skillsPayload.primarySkills,
            secondarySkills: data.secondarySkills
                ? serializeSkills(data.secondarySkills)
                : skillsPayload.secondarySkills,
            resumeText: skillsPayload.resumeText,
            vendorId: data.vendorId ?? null,
            submittedByUserId: data.submittedByUserId ?? null,
            createdBy: data.createdBy ?? null,
            ...buildCandidateSearchIndexFields({
                name: data.name,
                email: data.email,
                role: data.role,
                jobTitle: requirement?.title ?? data.role,
                location: profile.location,
                currentCompany: profile.currentCompany,
                primarySkills: data.primarySkills
                    ? serializeSkills(data.primarySkills)
                    : skillsPayload.primarySkills,
                secondarySkills: data.secondarySkills
                    ? serializeSkills(data.secondarySkills)
                    : skillsPayload.secondarySkills,
                resumeText: skillsPayload.resumeText,
                totalExperience: profile.totalExperience,
                currentCTC: profile.currentCTC,
                expectedCTC: profile.expectedCTC,
                noticePeriod: profile.noticePeriod,
            }),
        };
        const existing = await findCandidateByEmail(data.email);
        const row = existing
            ? await prisma.candidate.update({
                where: { id: existing.id },
                data: payload,
            })
            : await prisma.candidate.create({
                data: {
                    email: data.email.toLowerCase(),
                    matchScore: 0,
                    ...payload,
                },
            });
        const fullReq = requirement
            ? await prisma.requirement.findUnique({ where: { id: requirement.id } })
            : null;
        if (fullReq) {
            const { score } = computeMatchScore(row, fullReq, data.resumeSnippet);
            await prisma.candidate.update({
                where: { id: row.id },
                data: { matchScore: score },
            });
        }
        await attachResume(row.id, {
            name: data.name,
            email: data.email,
            role: data.role,
            location: data.location,
            snippet: data.resumeSnippet,
            primarySkills: data.primarySkills,
            secondarySkills: data.secondarySkills,
        });
        return row;
    }
    console.log('Seeding candidates (≤3 per pipeline stage; portals capped)...');
    const candidateSeeds = new Map();
    // Coverage first so every stage is represented, then core fills gaps — never bulk.
    let allCandidates = takeAtMostPerKey([...DEMO_COVERAGE_CANDIDATES, ...DEMO_CANDIDATES], (c) => c.status);
    // Extra portal caps: vendor submissions & referrals ≤3 per stage within that portal.
    const vendorByStage = new Map();
    const referralByStage = new Map();
    allCandidates = allCandidates.filter((c) => {
        if (c.vendorSubmitted) {
            const n = vendorByStage.get(c.status) ?? 0;
            if (n >= DEMO_MAX_PER_STAGE)
                return false;
            vendorByStage.set(c.status, n + 1);
        }
        const isReferral = Boolean(c.referredByRole) ||
            /referral/i.test(c.source ?? '');
        if (isReferral) {
            const n = referralByStage.get(c.status) ?? 0;
            if (n >= DEMO_MAX_PER_STAGE)
                return false;
            referralByStage.set(c.status, n + 1);
        }
        return true;
    });
    for (const c of allCandidates) {
        candidateSeeds.set(c.email.toLowerCase(), c);
        await upsertCandidate({
            ...c,
            vendorId: c.vendorSubmitted ? vendor.id : undefined,
            submittedByUserId: c.vendorSubmitted ? vendorUserId : undefined,
            createdBy: c.vendorSubmitted ? vendorUserId : recruiterId,
        });
    }
    async function seedPortalUser(p) {
        const status = p.status ?? 'TO_BE_SCREENED';
        const existingForStatus = await prisma.candidate.count({ where: { status } });
        const already = await prisma.candidate.findFirst({
            where: { email: { equals: p.email, mode: 'insensitive' } },
            select: { id: true, status: true },
        });
        // Respect ≤3 per stage: only create new portal candidates when under the cap.
        if (!already && existingForStatus >= DEMO_MAX_PER_STAGE)
            return;
        const requirement = p.applyToJobCode ? reqByCode.get(p.applyToJobCode) : undefined;
        const snippet = p.resumeSnippet ??
            (requirement
                ? `${p.name} — applied via candidate portal for ${requirement.title}.`
                : `${p.name} — candidate portal profile.`);
        const portalSeed = {
            email: p.email,
            name: p.name,
            role: requirement?.title ?? 'Candidate',
            status: already ? already.status : status,
            source: p.applyToJobCode ? 'Candidate Portal' : 'Candidate Portal',
            jobCode: p.applyToJobCode,
            phone: p.phone,
            location: p.location,
            totalExperience: p.totalExperience,
            currentCompany: p.currentCompany,
            primarySkills: p.primarySkills,
            secondarySkills: p.secondarySkills,
            resumeSnippet: snippet,
            interviewProgress: p.interviewProgress,
        };
        candidateSeeds.set(p.email.toLowerCase(), portalSeed);
        const row = await upsertCandidate({
            email: p.email,
            name: p.name,
            role: requirement?.title ?? p.name,
            status: portalSeed.status,
            source: 'Candidate Portal',
            jobCode: p.applyToJobCode,
            phone: p.phone,
            location: p.location,
            totalExperience: p.totalExperience,
            currentCompany: p.currentCompany,
            currentCTC: p.currentCTC,
            expectedCTC: p.expectedCTC,
            noticePeriod: p.noticePeriod,
            pan: p.pan,
            linkedIn: p.linkedIn,
            primarySkills: p.primarySkills,
            secondarySkills: p.secondarySkills,
            resumeSnippet: snippet,
        });
        const userId = userByEmail.get(p.email.toLowerCase());
        if (userId && requirement) {
            const fullReq = await prisma.requirement.findUnique({
                where: { id: requirement.id },
                select: { id: true, jobCode: true, title: true },
            });
            if (fullReq) {
                await ensurePortalApplicationLog(row.id, userId, fullReq, p.name);
            }
        }
    }
    console.log('Seeding portal accounts (≤3 candidate portal profiles)...');
    const portalUsers = DEMO_PORTAL_USERS.slice(0, DEMO_MAX_PER_STAGE);
    for (const p of portalUsers) {
        await seedPortalUser(p);
    }
    // Interview rounds + feedback from demo metadata
    await seedInterviewRounds(candidateSeeds, userByEmail);
    const interviewerId = userByEmail.get(devUserEmail('INTERVIEWER')) ?? userByEmail.get(devUserEmail('ADMIN'));
    if (interviewerId) {
        const awaitingCount = await ensureAwaitingFeedbackInterviews(candidateSeeds, interviewerId, DEMO_MAX_PER_STAGE);
        console.log(`Interviews awaiting feedback: ${awaitingCount}`);
        const panelInterviewerIds = [
            ...new Set([
                interviewerId,
                userByEmail.get(devUserEmail('HIRING_MANAGER')),
                userByEmail.get(devUserEmail('RECRUITER')),
                userByEmail.get(devUserEmail('ADMIN')),
            ].filter(Boolean)),
        ];
        const upcomingCount = await ensureUpcomingInterviews(panelInterviewerIds, DEMO_MAX_PER_STAGE);
        console.log(`Upcoming interviews: ${upcomingCount}`);
    }
    const panels = await configureDefaultInterviewPanels({
        preferredEmailsByOrder: {
            0: [
                devUserEmail('INTERVIEWER'),
                'nisha.kamath@stitch-ats.in',
                'pradeep.naidu@stitch-ats.in',
            ],
            1: [
                devUserEmail('HIRING_MANAGER'),
                'preeti.gowda@stitch-ats.in',
                'harish.kulkarni@stitch-ats.in',
            ],
            2: [devUserEmail('HR_MANAGER'), 'gautam.mehta@stitch-ats.in', 'shalini.verma@stitch-ats.in'],
        },
    });
    console.log(`Interview panels: ${panels.map((p) => `${p.name}=${p.interviewerIds.length}`).join(', ')}`);
    // Fill skill/competency formData on any incomplete feedback rows (incl. prior seeds)
    const feedbackFilled = await backfillIncompleteFeedbacks();
    if (feedbackFilled > 0) {
        console.log(`Backfilled complete formData on ${feedbackFilled} feedback(s).`);
    }
    // Offers for OFFER / HIRED candidates (all offer statuses via coverage seeds)
    await seedOffers(candidateSeeds, recruiterId);
    await enforceCandidateStageCaps();
    const referralsLinked = await linkDemoReferrals(candidateSeeds, userByEmail);
    console.log(`Referral-linked candidates: ${referralsLinked}`);
    await syncRequirementFilledCounts(reqByCode);
    // Backfill joiningDate + employeeId for JOINED candidates so RequirementPositionSlots shows real data.
    const joinedEmployeesSeeded = await backfillJoinedCandidateData();
    if (joinedEmployeesSeeded > 0) {
        console.log(`Joined candidate data (employee IDs + joining dates): ${joinedEmployeesSeeded}`);
    }
    // Sync position slots so the Requirement Detail page shows hired candidates with their data.
    let slotsSynced = 0;
    for (const [, req] of reqByCode) {
        const filled = await prisma.candidate.count({
            where: { requirementId: req.id, status: { in: ['JOINED', 'HIRED'] } },
        });
        if (filled > 0) {
            await syncRequirementPositionSlots(req.id);
            slotsSynced++;
        }
    }
    if (slotsSynced > 0) {
        console.log(`Position slots synced for ${slotsSynced} requirement(s) with hired candidates.`);
    }
    const changeRequestsSeeded = await seedDemoChangeRequests(userByEmail);
    console.log(`Change requests: ${changeRequestsSeeded} demo row(s) ensured`);
    const activitySeeded = await seedDemoActivityTour(userByEmail, recruiterId);
    console.log(`Activity log samples: ${activitySeeded}`);
    console.log('\nDemo data ready (full section coverage):');
    try {
        const counts = await Promise.all([
            prisma.user.count(),
            prisma.requirement.count(),
            prisma.businessRequirement.count(),
            prisma.clientDeal.count(),
            prisma.candidate.count(),
            prisma.candidate.count({ where: { source: 'Candidate Portal' } }),
            prisma.candidate.count({ where: { vendorId: { not: null } } }),
            prisma.candidate.count({ where: { referredByUserId: { not: null } } }),
            prisma.offer.count(),
            prisma.interview.count(),
            prisma.changeRequest.count(),
            prisma.activityLog.count(),
        ]);
        console.log(`  Users: ${counts[0]} (password: ${DEV_PASSWORD})`);
        console.log(`  Requirements: ${counts[1]}`);
        console.log(`  Business requirements: ${counts[2]}`);
        console.log(`  Client deals: ${counts[3]}`);
        console.log(`  Candidates: ${counts[4]} (${counts[5]} portal, ${counts[6]} vendor, ${counts[7]} referral-linked)`);
        console.log(`  Offers: ${counts[8]}`);
        console.log(`  Interviews: ${counts[9]}`);
        console.log(`  Change requests: ${counts[10]}`);
        console.log(`  Activity logs: ${counts[11]}`);
    }
    catch (err) {
        console.warn('  (Could not print final counts — data was seeded. Transient DB error:', err instanceof Error ? err.message : err, ')');
        console.log(`  Staff / portal password: ${DEV_PASSWORD}`);
    }
    console.log('  Candidate portal logins (password: password):');
    for (const p of DEMO_PORTAL_USERS.slice(0, DEMO_MAX_PER_STAGE)) {
        const applied = p.applyToJobCode ? ` → ${p.applyToJobCode}` : ' (profile only, no application)';
        console.log(`    ${p.email}${applied}`);
    }
    console.log('  Mock cap: ≤3 rows per stage / portal bucket.');
    console.log('  Re-run with --fresh to replace hiring data.\n');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await closePdfBrowser();
    await prisma.$disconnect();
});
