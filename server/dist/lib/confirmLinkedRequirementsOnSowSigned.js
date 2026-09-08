import { prisma } from './prisma.js';
import { parseBusinessStageHistory } from './businessRequirementStageHistory.js';
import { linkedRequirementStagePercentage } from './businessStages.js';
import { logActivity } from '../services/activityLog.js';
import { notifyBusinessRequirementStageChanged } from './emailDispatch.js';
const CONFIRMED_STAGE = 'REQUIREMENT_CONFIRMED';
const LEGACY_PRE_CONFIRMED_STAGES = new Set([
    'REQUIREMENT_CREATED',
    'SOW',
    'SOW_SIGNED',
]);
/** When SOW is signed on the client card, confirm all linked active requirements. */
export async function confirmLinkedRequirementsOnSowSigned(clientDealId, description, actor) {
    const deal = await prisma.clientDeal.findUnique({ where: { id: clientDealId } });
    if (!deal)
        throw new Error('Not found');
    if (deal.status !== 'ACTIVE') {
        throw new Error('SOW cannot be signed on a cancelled client card');
    }
    const requirements = await prisma.businessRequirement.findMany({
        where: { clientDealId, status: 'ACTIVE' },
    });
    if (requirements.length === 0) {
        throw new Error('Add a requirement before signing SOW');
    }
    const toConfirm = requirements.filter((r) => LEGACY_PRE_CONFIRMED_STAGES.has(r.businessStage));
    if (toConfirm.length === 0) {
        return { deal, requirements };
    }
    const timestamp = new Date().toISOString();
    const confirmedPercentage = linkedRequirementStagePercentage(CONFIRMED_STAGE);
    const dealHistory = parseBusinessStageHistory(deal.stageHistory);
    dealHistory.push({
        stage: 'SOW_SIGNED',
        percentage: 75,
        by: actor.userId,
        at: timestamp,
        role: actor.role,
        description,
    });
    await prisma.clientDeal.update({
        where: { id: clientDealId },
        data: { stageHistory: JSON.stringify(dealHistory) },
    });
    const updatedRequirements = [];
    for (const existing of toConfirm) {
        const history = parseBusinessStageHistory(existing.stageHistory);
        history.push({
            stage: CONFIRMED_STAGE,
            percentage: confirmedPercentage,
            by: actor.userId,
            at: timestamp,
            role: actor.role,
            description,
        });
        const row = await prisma.businessRequirement.update({
            where: { id: existing.id },
            data: {
                businessStage: CONFIRMED_STAGE,
                stagePercentage: confirmedPercentage,
                stageHistory: JSON.stringify(history),
            },
        });
        updatedRequirements.push(row);
        await logActivity({
            entityType: 'BUSINESS_REQUIREMENT',
            entityId: row.id,
            action: 'STAGE_CHANGED',
            performedBy: actor.userId,
            performerRole: actor.role,
            timestamp,
            details: {
                title: row.title,
                stage: CONFIRMED_STAGE,
                percentage: confirmedPercentage,
                description,
                fromClientSowSigned: true,
            },
        });
        notifyBusinessRequirementStageChanged({
            id: row.id,
            title: row.title,
            client: row.client,
            accountManager: row.accountManager,
            hiringManager: row.hiringManager,
            stage: CONFIRMED_STAGE,
            description,
        });
    }
    await logActivity({
        entityType: 'CLIENT_DEAL',
        entityId: deal.id,
        action: 'SOW_SIGNED',
        performedBy: actor.userId,
        performerRole: actor.role,
        timestamp,
        details: {
            client: deal.client,
            description,
            confirmedRequirementIds: updatedRequirements.map((r) => r.id),
        },
    });
    const refreshedDeal = await prisma.clientDeal.findUnique({ where: { id: clientDealId } });
    return {
        deal: refreshedDeal ?? deal,
        requirements: updatedRequirements,
    };
}
