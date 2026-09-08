import { isAdminRole } from './roles.js';
import { BUSINESS_MUTATE_ROLES, BUSINESS_VIEW_ROLES, BusinessRequirementAccessError, canMutateBusinessRequirement, canViewBusinessRequirement, } from './businessRequirementAccess.js';
export { BUSINESS_MUTATE_ROLES, BUSINESS_VIEW_ROLES, BusinessRequirementAccessError };
export function canMutateClientDeal(auth, row) {
    return canMutateBusinessRequirement(auth, row);
}
export function canViewClientDeal(auth, row) {
    return canViewBusinessRequirement(auth, row);
}
export async function buildClientDealListWhere(auth) {
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
export async function assertCanViewClientDeal(auth, id) {
    const { prisma } = await import('./prisma.js');
    const row = await prisma.clientDeal.findUnique({
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
    if (!canViewClientDeal(auth, row)) {
        throw new BusinessRequirementAccessError('Forbidden');
    }
    return row;
}
export async function assertCanMutateClientDeal(auth, id) {
    const { prisma } = await import('./prisma.js');
    const row = await prisma.clientDeal.findUnique({
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
    if (!canMutateClientDeal(auth, row)) {
        throw new BusinessRequirementAccessError('Forbidden');
    }
    return row;
}
