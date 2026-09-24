/**
 * Full-pipeline / full-section demo coverage for `npm run db:seed-demo`.
 * Ensures every candidate stage, offer status, requirement posting status,
 * hiring stage, and client-deal stage has at least one demo row.
 */
import { CANDIDATE_PIPELINE_STATUSES } from '../lib/candidateStatuses.js';
import { OFFER_STATUSES } from '../lib/offerTransitions.js';
const COV_SKILLS = ['TypeScript', 'React', 'Node.js', 'PostgreSQL'];
const COV_SECONDARY = ['AWS', 'Docker'];
const JD = `## Coverage role

Demo requirement used to exercise every ATS section and pipeline stage.

### Responsibilities
• Collaborate with hiring and TA teams on demo workflows
• Keep profiles complete for QA walkthroughs

### Requirements
• 4+ years relevant experience
• Strong communication`;
function covReq(partial) {
    return {
        department: 'Engineering',
        hiringManager: 'Preeti Gowda',
        accountManager: 'Karthik Subramanian',
        client: 'Stitch Internal',
        location: 'Bangalore',
        locationCity: 'Bangalore',
        workMode: 'HYBRID',
        employmentType: 'REGULAR',
        seniorityLevel: 'SPECIALIST',
        experienceMinYears: 4,
        experienceMaxYears: 8,
        salaryBand: '24',
        priority: 'MEDIUM',
        openings: 2,
        filled: 0,
        visibleToCandidates: true,
        visibleToVendors: true,
        description: partial.title,
        jobDescription: JD,
        primarySkills: [...COV_SKILLS],
        secondarySkills: [...COV_SECONDARY],
        ...partial,
    };
}
/** Posting statuses + hiring-stage variety. Keep ≤3 rows per posting status. */
export const DEMO_COVERAGE_REQUIREMENTS = [
    covReq({
        jobCode: 'REQCOV17072026001',
        title: 'Coverage — On Hold (28d orange)',
        status: 'ON_HOLD',
        hiringStage: 'SOURCING',
        priority: 'MEDIUM',
        agingDays: 28,
        visibleToCandidates: false,
        visibleToVendors: false,
    }),
    covReq({
        jobCode: 'REQCOV17072026002',
        title: 'Coverage — Closed Role',
        status: 'CLOSED',
        hiringStage: 'JOINED',
        openings: 1,
        filled: 1,
        priority: 'HIGH',
        agingDays: 50,
        visibleToCandidates: false,
        visibleToVendors: false,
    }),
    covReq({
        jobCode: 'REQCOV17072026003',
        title: 'Coverage — Cancelled Role',
        status: 'CANCELLED',
        hiringStage: 'SOURCING',
        openings: 3,
        agingDays: 15,
        visibleToCandidates: false,
        visibleToVendors: false,
    }),
    covReq({
        jobCode: 'REQCOV17072026004',
        title: 'Coverage — Rejected Posting',
        status: 'REJECTED',
        hiringStage: 'SOURCING',
        visibleToCandidates: false,
        visibleToVendors: false,
    }),
    covReq({
        jobCode: 'REQCOV17072026005',
        title: 'Coverage — Orange Aging (25d)',
        status: 'LIVE',
        hiringStage: 'L2_INTERVIEW',
        priority: 'HIGH',
        agingDays: 25,
    }),
    covReq({
        jobCode: 'REQCOV17072026006',
        title: 'Coverage — Red Aging (45d)',
        status: 'LIVE',
        hiringStage: 'HR_INTERVIEW',
        priority: 'HIGH',
        agingDays: 45,
    }),
    covReq({
        jobCode: 'REQCOV17072026008',
        title: 'Coverage — Referral Showcase',
        status: 'LIVE',
        hiringStage: 'SOURCING',
        referralBonusAmount: 50000,
        visibleToCandidates: true,
        visibleToVendors: true,
        agingDays: 8,
    }),
    covReq({
        jobCode: 'REQCOV17072026009',
        title: 'Coverage — Pending Approval',
        status: 'PENDING_APPROVAL',
        hiringStage: 'SOURCING',
        visibleToCandidates: false,
        visibleToVendors: false,
    }),
];
function covCandidate(partial) {
    return {
        role: 'Senior Software Engineer',
        source: 'Recruiter Added',
        jobCode: 'REQ28062026001',
        location: 'Bangalore',
        totalExperience: '6 Years',
        currentCompany: 'Infosys',
        primarySkills: [...COV_SKILLS],
        secondarySkills: [...COV_SECONDARY],
        resumeSnippet: `${partial.name} — Senior Software Engineer with hands-on React, Node.js, and PostgreSQL experience.`,
        ...partial,
    };
}
/**
 * One candidate for every pipeline status that the core/bulk demos may miss,
 * plus offer-status ladder rows and referral-linked profiles.
 * Names are realistic; stage coverage is identified by email / status only.
 */
export const DEMO_COVERAGE_CANDIDATES = [
    // —— Missing / thin pipeline stages ——
    covCandidate({
        email: 'cov.screen.select@ats.igsglobal.co',
        name: 'Ananya Krishnan',
        status: 'SCREEN_SELECT',
        source: 'LinkedIn',
    }),
    covCandidate({
        email: 'cov.l1.reject@ats.igsglobal.co',
        name: 'Bharath Menon',
        status: 'L1_INTERVIEW_REJECT',
        interviewProgress: 'l1-awaiting-feedback',
    }),
    covCandidate({
        email: 'cov.managerial@ats.igsglobal.co',
        name: 'Chitra Nambiar',
        status: 'MANAGERIAL_INTERVIEW',
        interviewProgress: 'l1-done-l2-scheduled',
    }),
    covCandidate({
        email: 'cov.managerial.reject@ats.igsglobal.co',
        name: 'Deepak Hegde',
        status: 'MANAGERIAL_INTERVIEW_REJECT',
        interviewProgress: 'l1-done-l2-scheduled',
    }),
    covCandidate({
        email: 'cov.client.interview@ats.igsglobal.co',
        name: 'Esha Balakrishnan',
        status: 'CLIENT_INTERVIEW',
        interviewProgress: 'l1-done-l2-scheduled',
    }),
    covCandidate({
        email: 'cov.client.reject@ats.igsglobal.co',
        name: 'Farhan Qureshi',
        status: 'CLIENT_INTERVIEW_REJECT',
        interviewProgress: 'l1-done-l2-scheduled',
    }),
    covCandidate({
        email: 'cov.hr.interview@ats.igsglobal.co',
        name: 'Gayatri Rao',
        status: 'HR_INTERVIEW',
        interviewProgress: 'l1-done-l2-scheduled',
    }),
    covCandidate({
        email: 'cov.hr.select@ats.igsglobal.co',
        name: 'Harsha Shetty',
        status: 'HR_INTERVIEW_SELECT',
        interviewProgress: 'all-rounds-complete',
    }),
    covCandidate({
        email: 'cov.hr.reject@ats.igsglobal.co',
        name: 'Ishita Banerjee',
        status: 'HR_INTERVIEW_REJECT',
        interviewProgress: 'all-rounds-complete',
    }),
    covCandidate({
        email: 'cov.offered@ats.igsglobal.co',
        name: 'Jatin Malhotra',
        status: 'OFFERED',
        interviewProgress: 'all-rounds-complete',
        offerStatus: 'SENT',
    }),
    covCandidate({
        email: 'cov.offer.accepted@ats.igsglobal.co',
        name: 'Kavya Srinivasan',
        status: 'OFFER_ACCEPTED',
        interviewProgress: 'all-rounds-complete',
        offerStatus: 'ACCEPTED',
    }),
    covCandidate({
        email: 'cov.position.abort@ats.igsglobal.co',
        name: 'Lakshmi Venkatesh',
        status: 'POSITION_ABORT',
        interviewProgress: 'all-rounds-complete',
    }),
    covCandidate({
        email: 'cov.candidate.abort@ats.igsglobal.co',
        name: 'Mohan Das',
        status: 'CANDIDATE_ABORT',
        source: 'LinkedIn',
    }),
    covCandidate({
        email: 'cov.bank@ats.igsglobal.co',
        name: 'Nisha Kulkarni',
        status: 'BANK',
        source: 'Referral',
        referredByRole: 'EMPLOYEE',
        referralRelationship: 'Former colleague',
        referralNotes: 'Strong backend hire — park for next opening.',
    }),
    covCandidate({
        email: 'cov.onhold@ats.igsglobal.co',
        name: 'Omkar Patil',
        status: 'ON_HOLD',
        source: 'Employee Referral',
        referredByRole: 'EMPLOYEE',
        referralRelationship: 'College friend',
        referralNotes: 'Candidate asked to pause for 30 days.',
    }),
    // —— Offer approval ladder (≤3 TO_BE_OFFERED + ≤3 OFFERED) ——
    covCandidate({
        email: 'cov.offer.draft@ats.igsglobal.co',
        name: 'Pooja Agarwal',
        status: 'TO_BE_OFFERED',
        jobCode: 'REQCOV17072026005',
        interviewProgress: 'all-rounds-complete',
        offerStatus: 'DRAFT',
    }),
    covCandidate({
        email: 'cov.offer.hr.approval@ats.igsglobal.co',
        name: 'Qasim Ansari',
        status: 'TO_BE_OFFERED',
        jobCode: 'REQCOV17072026005',
        interviewProgress: 'all-rounds-complete',
        offerStatus: 'PENDING_HR_APPROVAL',
    }),
    covCandidate({
        email: 'cov.offer.exec.approval@ats.igsglobal.co',
        name: 'Ritu Chopra',
        status: 'TO_BE_OFFERED',
        jobCode: 'REQCOV17072026005',
        interviewProgress: 'all-rounds-complete',
        offerStatus: 'PENDING_EXEC_APPROVAL',
    }),
    covCandidate({
        email: 'cov.offer.approved@ats.igsglobal.co',
        name: 'Tanvi Deshmukh',
        status: 'OFFERED',
        jobCode: 'REQCOV17072026005',
        interviewProgress: 'all-rounds-complete',
        offerStatus: 'APPROVED',
    }),
    covCandidate({
        email: 'cov.offer.negotiation@ats.igsglobal.co',
        name: 'Uday Bhatia',
        status: 'OFFERED',
        jobCode: 'REQCOV17072026005',
        interviewProgress: 'all-rounds-complete',
        offerStatus: 'NEGOTIATION',
    }),
    // —— Referral portal showcase (≤3) ——
    covCandidate({
        email: 'cov.referral.screen@ats.igsglobal.co',
        name: 'Waseem Khan',
        status: 'TO_BE_SCREENED',
        source: 'Employee Referral',
        jobCode: 'REQCOV17072026008',
        referredByRole: 'EMPLOYEE',
        referralRelationship: 'Team mate',
        referralNotes: 'Referred via employee portal for coverage role.',
    }),
    covCandidate({
        email: 'cov.referral.l1@ats.igsglobal.co',
        name: 'Aditi Saxena',
        status: 'L1_INTERVIEW',
        source: 'Employee Referral',
        jobCode: 'REQCOV17072026008',
        interviewProgress: 'l1-scheduled',
        referredByRole: 'EMPLOYEE',
        referralRelationship: 'Friend',
        referralNotes: 'Strong React skills — referral bonus role.',
    }),
    covCandidate({
        email: 'cov.referral.joined@ats.igsglobal.co',
        name: 'Yash Thakur',
        status: 'JOINED',
        source: 'Employee Referral',
        jobCode: 'REQCOV17072026008',
        interviewProgress: 'all-rounds-complete',
        offerStatus: 'ACCEPTED',
        referredByRole: 'EMPLOYEE',
        referralRelationship: 'Former manager',
        referralNotes: 'Joined via referral — bonus eligible.',
    }),
];
export const DEMO_CLIENT_DEALS = [
    {
        client: 'Coverage Client — Discussion',
        businessStage: 'INITIAL_DISCUSSION',
        notes: 'Early discovery call; scoping volumes for Q3.',
    },
    {
        client: 'Coverage Client — Proposal',
        businessStage: 'PROPOSAL_SENT',
        notes: 'Commercial proposal shared; awaiting feedback.',
        linkedRequirement: {
            title: 'Coverage BR — Proposal Role',
            department: 'Engineering',
            businessStage: 'REQUIREMENT_CREATED',
            openings: 2,
            priority: 'MEDIUM',
            location: 'Hyderabad',
            workMode: 'HYBRID',
            employmentType: 'REGULAR',
            seniorityLevel: 'SPECIALIST',
            experienceMinYears: 3,
            experienceMaxYears: 7,
            salaryBand: '18',
            description: 'Linked requirement created while proposal is out.',
            jobDescription: JD,
            primarySkills: COV_SKILLS,
            secondarySkills: COV_SECONDARY,
        },
    },
    {
        client: 'Coverage Client — Negotiation',
        businessStage: 'NEGOTIATION',
        notes: 'Rate card negotiation in progress.',
        linkedRequirement: {
            title: 'Coverage BR — Confirmed Role',
            department: 'Product',
            businessStage: 'REQUIREMENT_CONFIRMED',
            openings: 1,
            priority: 'HIGH',
            location: 'Pune',
            workMode: 'ONSITE',
            employmentType: 'REGULAR',
            seniorityLevel: 'SPECIALIST',
            experienceMinYears: 5,
            experienceMaxYears: 10,
            salaryBand: '28',
            description: 'Confirmed role on negotiated client card.',
            jobDescription: JD,
            primarySkills: ['Product Strategy', 'Roadmapping', 'Agile'],
            secondarySkills: ['SQL', 'Analytics'],
        },
    },
];
/** Standalone BR stage not already covered by DEMO_BUSINESS_REQUIREMENTS. */
export const DEMO_COVERAGE_BUSINESS_REQUIREMENTS = [
    {
        title: 'Coverage — SOW Stage Engagement',
        client: 'Coverage Client — SOW',
        department: 'Engineering',
        accountManagerRole: 'ACCOUNT_MANAGER',
        hiringManagerRole: 'HIRING_MANAGER',
        businessStage: 'SOW',
        priority: 'HIGH',
        openings: 4,
        location: 'Chennai',
        locationCity: 'Chennai',
        workMode: 'HYBRID',
        employmentType: 'REGULAR',
        seniorityLevel: 'SPECIALIST',
        experienceMinYears: 4,
        experienceMaxYears: 9,
        salaryBand: '22',
        description: 'Standalone business requirement at SOW stage.',
        jobDescription: JD,
        primarySkills: COV_SKILLS,
        secondarySkills: COV_SECONDARY,
    },
];
/** Sanity helpers for docs / tests. */
export function coveragePipelineStatuses() {
    return CANDIDATE_PIPELINE_STATUSES;
}
export function coverageOfferStatuses() {
    return OFFER_STATUSES;
}
