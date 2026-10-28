/** Every email rendered with sample data — shared by preview.ts and sendSamples.ts. */
import { DEFAULT_WORKFLOW_TEMPLATES, WORKFLOW_MAIL_KEYS, WORKFLOW_MAIL_LABELS, renderWorkflowPreview } from '../lib/workflowMail.js';
import * as T from './templates.js';
const at = 'Tue, 14 Oct 2026, 11:00 AM IST';
const teams = 'https://teams.microsoft.com/l/meetup-join/example';
const interview = { type: 'L1 Technical', scheduledAt: at, meetingLink: teams };
export const samples = [
    { id: 'interview-scheduled', name: 'Interview scheduled', group: 'Candidate', email: T.interviewCandidateEmail({ ...interview, candidateName: 'Priya Raman', change: 'scheduled' }) },
    { id: 'interview-rescheduled', name: 'Interview rescheduled', group: 'Candidate', email: T.interviewCandidateEmail({ ...interview, candidateName: 'Priya Raman', change: 'rescheduled' }) },
    { id: 'interview-reminder-candidate', name: 'Interview reminder', group: 'Candidate', email: T.interviewReminderEmail({ ...interview, recipientName: 'Priya', hoursUntil: 1, audience: 'candidate' }) },
    { id: 'interview-cancelled-candidate', name: 'Interview cancelled', group: 'Candidate', email: T.interviewCancelledEmail({ recipientName: 'Priya', type: 'L1 Technical', scheduledAt: at, audience: 'candidate' }) },
    { id: 'status-progress', name: 'Application update · progress', group: 'Candidate', email: T.candidateStatusEmail({ candidateName: 'Priya', status: 'L1_INTERVIEW', jobTitle: 'Senior SDET' }) },
    { id: 'status-reject', name: 'Application update · not selected', group: 'Candidate', email: T.candidateStatusEmail({ candidateName: 'Priya', status: 'SCREEN_REJECT', jobTitle: 'Senior SDET' }) },
    { id: 'offer-sent', name: 'Offer extended', group: 'Candidate', email: T.offerSentEmail({ to: 'priya.raman@example.com', candidateName: 'Priya Raman', annualCtc: 2400000, portalOfferUrl: 'https://ats.igsglobal.co/candidate/offers/1', portalLoginUrl: 'https://ats.igsglobal.co/login', setupUrl: 'https://ats.igsglobal.co/login?reset=example-token', validUntil: '2026-10-20' }) },
    { id: 'job-description', name: 'Job description', group: 'Candidate', email: T.jobDescriptionEmail({ candidateName: 'Priya', jobTitle: 'Senior SDET', client: 'Northwind Media', jobCode: 'REQ-1042', jobDescription: 'We’re looking for a Senior SDET to own test automation for our streaming platform.\n\n• Build Playwright suites across web and TV apps\n• Design API tests with REST Assured\n• Keep CI/CD pipelines green' }) },
    { id: 'vendor-invite', name: 'Vendor portal invite', group: 'Vendor', email: T.vendorInviteEmail({ to: 'ravi@example.com', name: 'Ravi', setupUrl: 'https://ats.igsglobal.co/staffportal?reset=example-token', vendorName: 'Talentbridge Staffing' }) },
    { id: 'vendor-assignment', name: 'New job assignments', group: 'Vendor', email: T.vendorAssignmentEmail({ recipientName: 'Ravi', vendorName: 'Talentbridge Staffing', requirements: [{ title: 'OTT Test Lead', jobCode: 'REQ-1061' }, { title: 'Data Engineer II', jobCode: 'REQ-1057' }] }) },
    { id: 'vendor-decision', name: 'Onboarding decision', group: 'Vendor', email: T.staffNotificationEmail({ recipientName: 'Ravi', subject: 'Vendor onboarding approved — Talentbridge', headline: 'Onboarding approved', body: 'Your onboarding for Talentbridge Staffing was approved. Open the portal: https://ats.igsglobal.co/vendor-portal/onboarding', audience: 'vendor' }) },
    { id: 'referral-submitted', name: 'Referral submitted', group: 'Referral', email: T.referralSubmittedEmail({ referrerName: 'Sneha', candidateName: 'Kiran Das', jobTitle: 'Data Engineer II', jobCode: 'REQ-1057' }) },
    { id: 'referral-joined', name: 'Referral joined', group: 'Referral', email: T.referralStatusEmail({ referrerName: 'Sneha', candidateName: 'Kiran Das', jobTitle: 'Data Engineer II', status: 'JOINED' }) },
    { id: 'referral-rejected', name: 'Referral not selected', group: 'Referral', email: T.referralStatusEmail({ referrerName: 'Sneha', candidateName: 'Kiran Das', jobTitle: 'Data Engineer II', status: 'REJECTED' }) },
    { id: 'invite', name: 'Staff invite', group: 'Staff', email: T.inviteEmail({ to: 'rahul.verma@example.com', name: 'Rahul', role: 'HIRING_MANAGER', setupUrl: 'https://ats.igsglobal.co/staffportal?reset=example-token' }) },
    { id: 'password-reset', name: 'Password reset link', group: 'Staff', email: T.passwordResetEmail({ name: 'Rahul', resetUrl: 'https://ats.igsglobal.co/staffportal?reset=example-token' }) },
    { id: 'admin-password', name: 'Password set by admin', group: 'Staff', email: T.adminPasswordEmail({ name: 'Rahul', setByAdmin: true }) },
    { id: 'interviewer-assigned', name: 'Interviewer assigned', group: 'Staff', email: T.interviewerAssignedEmail({ ...interview, recipientName: 'Kavya', candidateName: 'Priya Raman', headline: 'You’re on the interview panel' }) },
    { id: 'interview-reminder-panel', name: 'Interview reminder (panel)', group: 'Staff', email: T.interviewReminderEmail({ ...interview, recipientName: 'Kavya', hoursUntil: 24, candidateName: 'Priya Raman', audience: 'staff' }) },
    { id: 'interview-cancelled-panel', name: 'Interview cancelled (panel)', group: 'Staff', email: T.interviewCancelledEmail({ recipientName: 'Kavya', type: 'L1 Technical', scheduledAt: at, candidateName: 'Priya Raman', audience: 'staff' }) },
    { id: 'offer-accepted', name: 'Offer accepted', group: 'Staff', email: T.offerOutcomeEmail({ recipientName: 'Neha', candidateName: 'Priya Raman', jobTitle: 'Senior SDET', baseSalary: 2400000, accepted: true }) },
    { id: 'offer-declined', name: 'Offer declined', group: 'Staff', email: T.offerOutcomeEmail({ recipientName: 'Neha', candidateName: 'Priya Raman', jobTitle: 'Senior SDET', baseSalary: 2400000, accepted: false }) },
    { id: 'new-candidate', name: 'New candidate', group: 'Staff', email: T.newCandidateNotificationEmail({ recipientName: 'Neha', candidateName: 'Priya Raman', candidateEmail: 'priya.raman@example.com', jobTitle: 'Senior SDET', jobCode: 'REQ-1042', source: 'Vendor', vendorName: 'Talentbridge Staffing' }) },
    { id: 'aging-40', name: 'Requirement aging (40 days)', group: 'Staff', email: T.requirementAgingAlertEmail({ recipientName: 'Arjun', title: 'Senior SDET', jobCode: 'REQ-1042', daysOpen: 41, threshold: 40, requirementUrl: 'https://ats.igsglobal.co/requirements/1' }) },
    { id: 'aging-20', name: 'Requirement aging (20 days)', group: 'Staff', email: T.requirementAgingAlertEmail({ recipientName: 'Arjun', title: 'Data Engineer II', jobCode: 'REQ-1057', daysOpen: 21, threshold: 20, requirementUrl: 'https://ats.igsglobal.co/requirements/2' }) },
    { id: 'staff-notification', name: 'Staff notification', group: 'Staff', email: T.staffNotificationEmail({ recipientName: 'Neha', subject: 'Vendor onboarding submitted — Talentbridge', headline: 'Vendor onboarding ready for review', body: 'Talentbridge Staffing completed onboarding and evaluation and awaits approval. Review: https://ats.igsglobal.co/vendors/1?tab=onboarding' }) },
    ...WORKFLOW_MAIL_KEYS.map((key) => ({
        id: `workflow-${key}`,
        name: WORKFLOW_MAIL_LABELS[key],
        group: 'Workflow',
        email: renderWorkflowPreview(key, DEFAULT_WORKFLOW_TEMPLATES[key]),
    })),
];
