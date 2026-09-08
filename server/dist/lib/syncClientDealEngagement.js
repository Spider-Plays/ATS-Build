import { prisma } from '../lib/prisma.js';
import { clientDealStagePercentage } from './businessStages.js';
import { parseBusinessStageHistory } from './businessRequirementStageHistory.js';
const MIN_PRE_SOW_WHEN_SOW_EXISTS = 'NEGOTIATION';
/** Bump client card pre-SOW stage when roles enter the SOW pipeline. */
export async function syncClientDealEngagementFromRequirements(clientDealId, actor) {
    const deal = await prisma.clientDeal.findUnique({ where: { id: clientDealId } });
    if (!deal || deal.status !== 'ACTIVE')
        return deal;
    const requirementCount = await prisma.businessRequirement.count({
        where: { clientDealId },
    });
    if (requirementCount === 0)
        return deal;
    const targetPercentage = clientDealStagePercentage(MIN_PRE_SOW_WHEN_SOW_EXISTS);
    if (deal.stagePercentage >= targetPercentage)
        return deal;
    const timestamp = new Date().toISOString();
    const history = parseBusinessStageHistory(deal.stageHistory);
    history.push({
        stage: MIN_PRE_SOW_WHEN_SOW_EXISTS,
        percentage: targetPercentage,
        by: actor?.userId ?? 'system',
        at: timestamp,
        role: actor?.role,
        description: 'Auto-advanced when a role entered the SOW pipeline',
    });
    return prisma.clientDeal.update({
        where: { id: clientDealId },
        data: {
            businessStage: MIN_PRE_SOW_WHEN_SOW_EXISTS,
            stagePercentage: targetPercentage,
            stageHistory: JSON.stringify(history),
        },
    });
}
