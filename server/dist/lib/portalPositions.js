import { deserializeSkills } from './skills.js';
import { isRequirementFull } from './requirementHiring.js';
function hasOpeningsRemaining(filled, openings) {
    return !isRequirementFull(filled, openings);
}
export function portalRequirementVisible(requirement) {
    if (!requirement)
        return false;
    if (requirement.status !== 'LIVE' || !requirement.visibleToCandidates)
        return false;
    return hasOpeningsRemaining(requirement.filled ?? 0, requirement.openings ?? 0);
}
export function referralRequirementVisible(requirement) {
    if (!requirement)
        return false;
    if (requirement.status !== 'LIVE' || !requirement.visibleToReferrals)
        return false;
    return hasOpeningsRemaining(requirement.filled ?? 0, requirement.openings ?? 0);
}
export function vendorRequirementVisible(requirement) {
    if (!requirement)
        return false;
    if (requirement.status !== 'LIVE' || !requirement.visibleToVendors)
        return false;
    return hasOpeningsRemaining(requirement.filled ?? 0, requirement.openings ?? 0);
}
export function portalPositionsWhere() {
    /** Same filter for authenticated portal and public /careers listings. */
    return { status: 'LIVE', visibleToCandidates: true };
}
export function mapPortalPosition(r) {
    const primarySkills = deserializeSkills(r.primarySkills);
    const secondarySkills = deserializeSkills(r.secondarySkills);
    const jobDescription = r.jobDescription?.trim() || undefined;
    const description = r.description?.trim() || undefined;
    return {
        id: r.id,
        jobCode: r.jobCode ?? r.id.slice(-8).toUpperCase(),
        client: r.client ?? undefined,
        title: r.title,
        department: r.department,
        location: r.location ?? undefined,
        locationCity: r.locationCity?.trim() || undefined,
        isRemote: r.isRemote === true,
        workMode: r.workMode ?? undefined,
        employmentType: r.employmentType ?? undefined,
        seniorityLevel: r.seniorityLevel ?? undefined,
        experienceMinYears: r.experienceMinYears ?? undefined,
        experienceMaxYears: r.experienceMaxYears ?? undefined,
        salaryBand: r.salaryBand?.trim() || undefined,
        priority: r.priority ?? undefined,
        openings: r.openings,
        filled: r.filled,
        description,
        jobDescription,
        primarySkills: primarySkills.length > 0 ? primarySkills : undefined,
        secondarySkills: secondarySkills.length > 0 ? secondarySkills : undefined,
        updatedAt: r.updatedAt.toISOString(),
    };
}
/** Public careers listings must not expose client names. */
export function mapPublicCareersPosition(r) {
    const { client: _client, ...position } = mapPortalPosition(r);
    return position;
}
