import { hasOrgWideAccess } from './orgAccess.js';
import { isAdminRole } from './roles.js';
export const BUSINESS_MUTATE_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'ACCOUNT_MANAGER',
    'HIRING_MANAGER',
];
export const BUSINESS_VIEW_ROLES = [
    ...BUSINESS_MUTATE_ROLES,
    'HR_HEAD',
    'HR_MANAGER',
];
export class BusinessRequirementAccessError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BusinessRequirementAccessError';
    }
}
export function canMutateBusinessRequirement(auth, row) {
    if (isAdminRole(auth.role))
        return true;
    if (!BUSINESS_MUTATE_ROLES.includes(auth.role)) {
        return false;
    }
    return (row.createdBy === auth.userId ||
        row.accountManager === auth.userId ||
        row.hiringManager === auth.userId);
}
export function canViewBusinessRequirement(auth, row) {
    if (hasOrgWideAccess(auth.role) && (auth.role === 'HR_HEAD' || auth.role === 'HR_MANAGER')) {
        return true;
    }
    if (isAdminRole(auth.role))
        return true;
    if (!BUSINESS_VIEW_ROLES.includes(auth.role)) {
        return false;
    }
    if (auth.role === 'HR_HEAD' || auth.role === 'HR_MANAGER')
        return true;
    return canMutateBusinessRequirement(auth, row);
}
export async function buildBusinessRequirementListWhere(auth) {
    if (isAdminRole(auth.role))
        return {};
    if (!BUSINESS_MUTATE_ROLES.includes(auth.role)) {
        return { id: { in: ['__none__'] } };
    }
    return {
        OR: [
            { createdBy: auth.userId },
            { accountManager: auth.userId },
            { hiringManager: auth.userId },
        ],
    };
}
export async function assertCanViewBusinessRequirement(auth, id) {
    const { prisma } = await import('./prisma.js');
    const row = await prisma.businessRequirement.findUnique({
        where: { id },
        select: {
            id: true,
            createdBy: true,
            accountManager: true,
            hiringManager: true,
        },
    });
    if (!row)
        throw new BusinessRequirementAccessError('Not found');
    if (!canViewBusinessRequirement(auth, row)) {
        throw new BusinessRequirementAccessError('Forbidden');
    }
    return row;
}
export async function assertCanMutateBusinessRequirement(auth, id) {
    const { prisma } = await import('./prisma.js');
    const row = await prisma.businessRequirement.findUnique({
        where: { id },
        select: {
            id: true,
            createdBy: true,
            accountManager: true,
            hiringManager: true,
        },
    });
    if (!row)
        throw new BusinessRequirementAccessError('Not found');
    if (!canMutateBusinessRequirement(auth, row)) {
        throw new BusinessRequirementAccessError('Forbidden');
    }
    return row;
}
export function isBusinessTeamRole(role) {
    return (isAdminRole(role) ||
        role === 'ACCOUNT_MANAGER' ||
        role === 'HIRING_MANAGER');
}
export function isHrPreviewRole(role) {
    return role === 'HR_HEAD' || role === 'HR_MANAGER';
}
/** Business requirements where the user is account or hiring manager. */
export async function businessRequirementIdsForStakeholder(userId) {
    const { prisma } = await import('./prisma.js');
    const rows = await prisma.businessRequirement.findMany({
        where: {
            OR: [{ accountManager: userId }, { hiringManager: userId }],
        },
        select: { id: true },
    });
    return rows.map((r) => r.id);
}
