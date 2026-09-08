import { prisma } from './prisma.js';
import { logActivity } from '../services/activityLog.js';
import { computeRequirementHiringStageFromCandidates, } from './requirementHiringDerive.js';
import { isRequirementFull, } from './requirementHiring.js';
import { syncRequirementPositionSlots } from './syncRequirementPositionSlots.js';
/** Keep requirement.filled in sync with JOINED candidates for that req */
export async function syncRequirementFilled(requirementId) {
    const hired = await prisma.candidate.count({
        where: { requirementId, status: { in: ['JOINED', 'HIRED'] } },
    });
    await prisma.requirement.update({
        where: { id: requirementId },
        data: { filled: hired, updatedAt: new Date() },
    });
    await syncRequirementPositionSlots(requirementId);
}
/**
 * Derive hiring stage from linked candidates (most advanced wins),
 * sync filled count, and close the req when all openings are hired.
 */
export async function syncRequirementHiringState(requirementId) {
    const existing = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: {
            id: true,
            status: true,
            openings: true,
            filled: true,
            hiringStage: true,
            approvalHistory: true,
            visibleToCandidates: true,
            visibleToReferrals: true,
            closedAt: true,
        },
    });
    if (!existing)
        return;
    if (['CANCELLED', 'REJECTED', 'PENDING_APPROVAL', 'DRAFT', 'APPROVED'].includes(existing.status)) {
        return;
    }
    await syncRequirementFilled(requirementId);
    const refreshed = await prisma.requirement.findUnique({
        where: { id: requirementId },
        select: {
            id: true,
            status: true,
            openings: true,
            filled: true,
            hiringStage: true,
            approvalHistory: true,
            visibleToCandidates: true,
            visibleToReferrals: true,
            closedAt: true,
        },
    });
    if (!refreshed)
        return;
    const full = isRequirementFull(refreshed.filled, refreshed.openings);
    let nextStage = full
        ? 'JOINED'
        : await computeRequirementHiringStageFromCandidates(requirementId);
    const timestamp = new Date().toISOString();
    const history = JSON.parse(refreshed.approvalHistory || '[]');
    const data = { updatedAt: new Date() };
    let stageChanged = false;
    let statusChanged = false;
    if ((refreshed.hiringStage ?? 'SOURCING') !== nextStage) {
        stageChanged = true;
        data.hiringStage = nextStage;
        history.push({
            action: 'HIRING_STAGE_CHANGED',
            by: 'system',
            at: timestamp,
            role: 'SYSTEM',
            comments: `${refreshed.hiringStage ?? 'SOURCING'} → ${nextStage} (from candidates)`,
        });
        data.approvalHistory = JSON.stringify(history);
    }
    if (full && (refreshed.status === 'LIVE' || refreshed.status === 'ON_HOLD')) {
        statusChanged = true;
        data.status = 'CLOSED';
        data.visibleToCandidates = false;
        data.visibleToReferrals = false;
        data.visibleToVendors = false;
        history.push({
            action: 'CLOSED',
            by: 'system',
            at: timestamp,
            role: 'SYSTEM',
            comments: `All ${refreshed.openings} position(s) filled`,
        });
        data.approvalHistory = JSON.stringify(history);
    }
    else if (!full &&
        refreshed.status === 'CLOSED' &&
        // Admin/manual closes set closedAt — do not auto-reopen those.
        !refreshed.closedAt) {
        statusChanged = true;
        data.status = 'LIVE';
        history.push({
            action: 'REOPENED',
            by: 'system',
            at: timestamp,
            role: 'SYSTEM',
            comments: `${refreshed.filled} of ${refreshed.openings} filled — reopened for remaining openings`,
        });
        data.approvalHistory = JSON.stringify(history);
    }
    if (!stageChanged && !statusChanged)
        return;
    await prisma.requirement.update({
        where: { id: requirementId },
        data,
    });
    if (stageChanged) {
        await logActivity({
            entityType: 'REQUIREMENT',
            entityId: requirementId,
            action: 'HIRING_STAGE_CHANGED',
            performedBy: 'system',
            performerRole: 'SYSTEM',
            details: {
                from: refreshed.hiringStage ?? 'SOURCING',
                to: nextStage,
                derivedFromCandidates: true,
            },
        });
    }
    if (statusChanged) {
        await logActivity({
            entityType: 'REQUIREMENT',
            entityId: requirementId,
            action: 'STATUS_CHANGED',
            performedBy: 'system',
            performerRole: 'SYSTEM',
            details: {
                status: data.status,
                reason: data.status === 'CLOSED' ? 'all_positions_filled' : 'openings_available',
                filled: refreshed.filled,
                openings: refreshed.openings,
            },
        });
    }
}
/** Refresh filled count / auto-close, then return the latest requirement row. */
export async function refreshRequirementHiringState(requirementId) {
    await syncRequirementHiringState(requirementId);
    return prisma.requirement.findUnique({ where: { id: requirementId } });
}
