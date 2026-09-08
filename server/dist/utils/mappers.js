import { defaultUserAvatarUrl } from '../lib/userAvatar.js';
import { parseFeatureTags } from '../lib/userTags.js';
import { parseApprovalChainJson } from '../lib/offerApprovalChain.js';
import { deserializeSkills } from '../lib/skills.js';
export function mapUser(u) {
    return {
        uid: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        tags: parseFeatureTags(u.permissions),
        themePreference: 'light',
        createdAt: u.createdAt.toISOString(),
        avatar: u.avatar ?? defaultUserAvatarUrl(u.name),
        phoneNumber: u.phoneNumber ?? undefined,
        address: u.address ?? undefined,
        resumeUrl: u.resumeUrl ?? undefined,
        status: u.status,
        authProvider: u.authProvider,
        department: u.department ?? undefined,
        lastLogin: u.lastLogin?.toISOString(),
        vendorId: u.vendorId ?? undefined,
        mustChangePassword: u.mustChangePassword,
    };
}
export function mapRequirement(r) {
    return {
        id: r.id,
        jobCode: r.jobCode ?? undefined,
        client: r.client ?? undefined,
        title: r.title,
        department: r.department,
        hiringManager: r.hiringManager,
        accountManager: r.accountManager ?? undefined,
        status: r.status,
        hiringStage: r.hiringStage,
        liveAt: r.liveAt?.toISOString(),
        onHoldAt: r.onHoldAt?.toISOString(),
        openings: r.openings,
        filled: r.filled,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        recruiters: JSON.parse(r.recruiters || '[]'),
        pendingRecruiters: JSON.parse(r.pendingRecruiters || '[]'),
        priority: r.priority,
        location: r.location ?? undefined,
        locationCity: r.locationCity ?? undefined,
        isRemote: r.isRemote ?? false,
        workMode: r.workMode ?? undefined,
        employmentType: r.employmentType ?? undefined,
        seniorityLevel: r.seniorityLevel ?? undefined,
        businessType: r.businessType ?? undefined,
        domain: r.domain ?? undefined,
        jobType: r.jobType ?? undefined,
        employmentChannel: r.employmentChannel ?? undefined,
        requirementFor: r.requirementFor ?? undefined,
        replacementDueTo: r.replacementDueTo ?? undefined,
        replacementEmployeeName: r.replacementEmployeeName ?? undefined,
        joinedEmployeeName: r.joinedEmployeeName ?? undefined,
        joinedEmployeeId: r.joinedEmployeeId ?? undefined,
        projectName: r.projectName ?? undefined,
        orgUnit: r.orgUnit ?? undefined,
        quarter: r.quarter ?? undefined,
        reqMonth: r.reqMonth ?? undefined,
        parentJobCode: r.parentJobCode ?? undefined,
        hireType: r.hireType ?? undefined,
        globalJobType: r.globalJobType ?? undefined,
        holdDays: r.holdDays ?? undefined,
        agingDays: r.agingDays ?? undefined,
        experienceLabel: r.experienceLabel ?? undefined,
        assignedVendorName: r.assignedVendorName ?? undefined,
        approvalStatus: r.approvalStatus ?? undefined,
        cancellationStatus: r.cancellationStatus ?? undefined,
        onboardSource: r.onboardSource ?? undefined,
        referrerName: r.referrerName ?? undefined,
        joiningDate: r.joiningDate?.toISOString(),
        joinedMonth: r.joinedMonth ?? undefined,
        joinedQuarter: r.joinedQuarter ?? undefined,
        education: (() => {
            try {
                const parsed = JSON.parse(r.education || '[]');
                return Array.isArray(parsed) ? parsed : [];
            }
            catch {
                return [];
            }
        })(),
        hireCategory: r.hireCategory ?? undefined,
        holdStartDate: r.holdStartDate?.toISOString(),
        holdEndDate: r.holdEndDate?.toISOString(),
        positionSlots: (() => {
            try {
                const parsed = JSON.parse(r.positionSlots || '[]');
                return Array.isArray(parsed) ? parsed : [];
            }
            catch {
                return [];
            }
        })(),
        experienceMinYears: r.experienceMinYears ?? undefined,
        experienceMaxYears: r.experienceMaxYears ?? undefined,
        salaryBand: r.salaryBand ?? undefined,
        targetStartDate: r.targetStartDate?.toISOString(),
        hiringDeadline: r.hiringDeadline?.toISOString(),
        description: r.description ?? undefined,
        jobDescription: r.jobDescription ?? r.description ?? undefined,
        primarySkills: deserializeSkills(r.primarySkills),
        secondarySkills: deserializeSkills(r.secondarySkills),
        createdBy: r.createdBy ?? undefined,
        createdByRole: r.createdByRole ?? undefined,
        approval: r.approval ? JSON.parse(r.approval) : undefined,
        approvalHistory: JSON.parse(r.approvalHistory || '[]'),
        versions: JSON.parse(r.versions || '[]'),
        currentVersion: r.currentVersion,
        visibleToCandidates: r.visibleToCandidates ?? true,
        visibleToVendors: r.visibleToVendors ?? false,
        visibleToReferrals: r.visibleToReferrals ?? true,
        referralBonusAmount: r.referralBonusAmount ?? undefined,
        closureReason: r.closureReason ?? undefined,
        closedAt: r.closedAt?.toISOString(),
    };
}
export function mapClientDeal(r, extras) {
    return {
        id: r.id,
        client: r.client,
        accountManager: r.accountManager,
        hiringManager: r.hiringManager,
        notes: r.notes ?? undefined,
        businessStage: r.businessStage,
        stagePercentage: r.stagePercentage,
        sowGatewayReached: r.sowGatewayReached,
        status: r.status,
        requirementCount: extras?.requirementCount,
        furthestRequirementStage: extras?.furthestRequirementStage,
        furthestRequirementPercentage: extras?.furthestRequirementPercentage,
        stageHistory: JSON.parse(r.stageHistory || '[]'),
        createdBy: r.createdBy ?? undefined,
        createdByRole: r.createdByRole ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
    };
}
export function mapBusinessRequirement(r) {
    return {
        id: r.id,
        clientDealId: r.clientDealId ?? undefined,
        title: r.title,
        client: r.client ?? undefined,
        department: r.department,
        accountManager: r.accountManager,
        hiringManager: r.hiringManager,
        businessStage: r.businessStage,
        stagePercentage: r.stagePercentage,
        status: r.status,
        publishedRequirementId: r.publishedRequirementId ?? undefined,
        stageHistory: JSON.parse(r.stageHistory || '[]'),
        openings: r.openings,
        priority: r.priority,
        location: r.location ?? undefined,
        locationCity: r.locationCity ?? undefined,
        isRemote: r.isRemote ?? false,
        workMode: r.workMode ?? undefined,
        employmentType: r.employmentType ?? undefined,
        seniorityLevel: r.seniorityLevel ?? undefined,
        experienceMinYears: r.experienceMinYears ?? undefined,
        experienceMaxYears: r.experienceMaxYears ?? undefined,
        salaryBand: r.salaryBand ?? undefined,
        targetStartDate: r.targetStartDate?.toISOString(),
        hiringDeadline: r.hiringDeadline?.toISOString(),
        description: r.description ?? undefined,
        jobDescription: r.jobDescription ?? r.description ?? undefined,
        primarySkills: deserializeSkills(r.primarySkills),
        secondarySkills: deserializeSkills(r.secondarySkills),
        createdBy: r.createdBy ?? undefined,
        createdByRole: r.createdByRole ?? undefined,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
    };
}
export function mapCandidate(c, ctx) {
    const req = ctx?.requirement;
    const recruiter = ctx?.recruiter;
    const referrer = ctx?.referrer;
    return {
        id: c.id,
        name: c.name,
        email: c.email,
        role: c.role,
        status: c.status,
        matchScore: c.matchScore,
        source: c.source,
        appliedDate: c.appliedDate.toISOString(),
        requirementId: c.requirementId ?? undefined,
        jobTitle: c.jobTitle ?? req?.title ?? undefined,
        reqId: req?.jobCode ?? (req ? req.id.slice(-8).toUpperCase() : undefined),
        client: req?.client ?? undefined,
        createdBy: c.createdBy ?? undefined,
        recruiterName: recruiter?.name ?? undefined,
        avatar: c.avatar ?? undefined,
        resumeFileName: c.resumeFileName ?? undefined,
        resumeMimeType: c.resumeMimeType ?? undefined,
        hasResume: !!c.resumeFileName,
        phone: c.phone ?? undefined,
        location: c.location ?? undefined,
        linkedIn: c.linkedIn ?? undefined,
        portfolio: c.portfolio ?? undefined,
        totalExperience: c.totalExperience ?? undefined,
        currentCompany: c.currentCompany ?? undefined,
        currentCTC: c.currentCTC ?? undefined,
        expectedCTC: c.expectedCTC ?? undefined,
        noticePeriod: c.noticePeriod ?? undefined,
        pan: c.pan ?? undefined,
        vendorId: c.vendorId ?? undefined,
        submittedByUserId: c.submittedByUserId ?? undefined,
        referredByUserId: c.referredByUserId ?? undefined,
        referredByName: referrer?.name ?? undefined,
        referredByEmail: referrer?.email ?? undefined,
        referredByDepartment: referrer?.department ?? undefined,
        referredByReferralCode: referrer?.referralCode ?? undefined,
        referralRelationship: c.referralRelationship ?? undefined,
        referralNotes: c.referralNotes ?? undefined,
        partnerName: c.partnerName ?? undefined,
        hireCategory: c.hireCategory ?? undefined,
        quarter: c.quarter ?? undefined,
        reqMonth: c.reqMonth ?? undefined,
        reqReceiptDate: c.reqReceiptDate?.toISOString(),
        legacyResumeId: c.legacyResumeId ?? undefined,
        sourceMonth: c.sourceMonth ?? undefined,
        sourceWeek: c.sourceWeek ?? undefined,
        preferredLocation: c.preferredLocation ?? undefined,
        primarySkills: deserializeSkills(c.primarySkills),
        secondarySkills: deserializeSkills(c.secondarySkills),
        offerDate: c.offerDate?.toISOString(),
        offerMonth: c.offerMonth ?? undefined,
        offerWeek: c.offerWeek ?? undefined,
        offerQuarter: c.offerQuarter ?? undefined,
        expectedJoiningDate: c.expectedJoiningDate?.toISOString(),
        joiningDate: c.joiningDate?.toISOString(),
        joiningMonth: c.joiningMonth ?? undefined,
        joiningQuarter: c.joiningQuarter ?? undefined,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
    };
}
export function mapInterview(i) {
    return {
        id: i.id,
        candidateId: i.candidateId,
        requirementId: i.requirementId,
        planStageId: i.planStageId ?? undefined,
        scheduledAt: i.scheduledAt.toISOString(),
        scheduledBy: i.scheduledBy ?? undefined,
        interviewerIds: JSON.parse(i.interviewerIds || '[]'),
        type: i.type,
        status: i.status,
        meetingLink: i.meetingLink ?? undefined,
        duration: i.duration ?? undefined,
        location: i.location ?? undefined,
        description: i.description ?? undefined,
    };
}
export function mapFeedback(f) {
    let formData = {};
    try {
        formData = JSON.parse(f.formData || '{}');
    }
    catch {
        formData = {};
    }
    return {
        id: f.id,
        interviewId: f.interviewId,
        interviewerId: f.interviewerId,
        candidateId: f.candidateId,
        rating: f.rating,
        technicalRating: f.technicalRating ?? undefined,
        communicationRating: f.communicationRating ?? undefined,
        comments: f.comments,
        recommendation: f.recommendation,
        formData,
        createdAt: f.createdAt.toISOString(),
    };
}
export function mapOffer(o) {
    const annualCtc = o.annualCtc ?? o.baseSalary;
    let compensation = undefined;
    let letterMeta = undefined;
    let approval = undefined;
    let approvalHistory = [];
    try {
        if (o.compensationJson && o.compensationJson !== '{}') {
            compensation = JSON.parse(o.compensationJson);
        }
    }
    catch {
        /* ignore */
    }
    try {
        if (o.letterMetaJson && o.letterMetaJson !== '{}') {
            letterMeta = JSON.parse(o.letterMetaJson);
        }
    }
    catch {
        /* ignore */
    }
    try {
        if (o.approval && o.approval !== '{}')
            approval = JSON.parse(o.approval);
    }
    catch {
        /* ignore */
    }
    let approvalChain = [];
    try {
        const chain = parseApprovalChainJson(o.approvalChainJson);
        approvalChain = chain.stages;
    }
    catch {
        /* ignore */
    }
    try {
        approvalHistory = JSON.parse(o.approvalHistory || '[]');
    }
    catch {
        /* ignore */
    }
    let history = [];
    try {
        const rawHistory = JSON.parse(o.history || '[]');
        history = rawHistory.map((item) => ({
            id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
            date: (typeof item.date === 'string' && item.date) ||
                (typeof item.at === 'string' && item.at) ||
                (typeof item.createdAt === 'string' && item.createdAt) ||
                '',
            action: typeof item.action === 'string' ? item.action : 'UPDATED',
            description: typeof item.description === 'string' ? item.description : '',
            userId: (typeof item.userId === 'string' && item.userId) ||
                (typeof item.by === 'string' && item.by) ||
                '',
        }));
    }
    catch {
        /* ignore */
    }
    return {
        id: o.id,
        candidateId: o.candidateId,
        requirementId: o.requirementId,
        baseSalary: o.baseSalary,
        annualCtc,
        equity: o.equity ?? undefined,
        bonus: o.bonus ?? undefined,
        status: o.status,
        history,
        letterContent: o.letterContent ?? undefined,
        compensation,
        letterMeta,
        letterHtml: o.letterHtml ?? undefined,
        approval,
        approvalHistory,
        approvalChain: approvalChain.length ? approvalChain : undefined,
        approvalStep: o.approvalStep ?? undefined,
        rejectionReason: o.rejectionReason ?? undefined,
        validUntil: o.validUntil?.toISOString(),
        sentAt: o.sentAt?.toISOString(),
        respondedAt: o.respondedAt?.toISOString(),
        respondedBy: o.respondedBy ?? undefined,
        createdAt: o.createdAt.toISOString(),
        createdBy: o.createdBy,
    };
}
export function mapActivityLog(l) {
    return {
        id: l.id,
        entityType: l.entityType,
        entityId: l.entityId,
        action: l.action,
        performedBy: l.performedBy,
        performerName: l.performerName ?? undefined,
        performerRole: l.performerRole ?? undefined,
        timestamp: l.timestamp.toISOString(),
        details: l.details ? JSON.parse(l.details) : undefined,
    };
}
