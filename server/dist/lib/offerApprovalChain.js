export const OFFER_APPROVER_ELIGIBLE_ROLES = [
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
];
export function createDefaultApprovalChain() {
    return {
        stages: [
            { id: crypto.randomUUID(), label: 'L1', approverIds: [] },
            { id: crypto.randomUUID(), label: 'L2', approverIds: [] },
        ],
    };
}
export function parseApprovalChainJson(raw) {
    if (!raw || raw === '[]' || raw === '{}') {
        return { stages: [] };
    }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return { stages: normalizeStages(parsed) };
        }
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.stages)) {
            return { stages: normalizeStages(parsed.stages) };
        }
    }
    catch {
        /* ignore */
    }
    return { stages: [] };
}
function normalizeStages(raw) {
    return raw
        .map((item) => {
        if (!item || typeof item !== 'object')
            return null;
        const o = item;
        const id = typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID();
        const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : 'Stage';
        const approverIds = Array.isArray(o.approverIds)
            ? o.approverIds.filter((id) => typeof id === 'string' && id.length > 0)
            : [];
        return { id, label, approverIds };
    })
        .filter((s) => s !== null);
}
export function serializeApprovalChain(chain) {
    return JSON.stringify(chain.stages);
}
export function usesApprovalChain(offer) {
    return parseApprovalChainJson(offer.approvalChainJson).stages.length >= 2;
}
export function validateApprovalChain(chain) {
    if (!chain.stages.length) {
        return 'At least L1 and L2 approval stages are required';
    }
    if (chain.stages.length < 2) {
        return 'At least L1 and L2 approval stages are required';
    }
    for (const stage of chain.stages) {
        if (!stage.label.trim()) {
            return 'Each approval stage must have a label';
        }
        if (!stage.approverIds.length) {
            return `${stage.label} must have at least one approver`;
        }
    }
    return null;
}
export function getCurrentStageIndex(offer) {
    if (offer.status !== 'PENDING_APPROVAL')
        return -1;
    const chain = parseApprovalChainJson(offer.approvalChainJson);
    if (!offer.approvalStep)
        return 0;
    const idx = chain.stages.findIndex((s) => s.id === offer.approvalStep);
    return idx >= 0 ? idx : 0;
}
export function getCurrentStage(offer) {
    const chain = parseApprovalChainJson(offer.approvalChainJson);
    const idx = getCurrentStageIndex(offer);
    if (idx < 0 || idx >= chain.stages.length)
        return null;
    return chain.stages[idx] ?? null;
}
export function canUserApproveCurrentStage(auth, offer) {
    if (auth.role === 'SUPER_ADMIN')
        return true;
    if (offer.createdBy === auth.userId)
        return false;
    const stage = getCurrentStage(offer);
    if (!stage)
        return false;
    return stage.approverIds.includes(auth.userId);
}
export function nextStatusAfterStageApproval(offer) {
    const chain = parseApprovalChainJson(offer.approvalChainJson);
    const idx = getCurrentStageIndex({
        status: 'PENDING_APPROVAL',
        approvalStep: offer.approvalStep,
        approvalChainJson: offer.approvalChainJson,
    });
    const nextIdx = idx + 1;
    if (nextIdx >= chain.stages.length) {
        return { status: 'APPROVED', approvalStep: null };
    }
    return { status: 'PENDING_APPROVAL', approvalStep: chain.stages[nextIdx].id };
}
export function getSubmitStateForChain(chain) {
    const first = chain.stages[0];
    if (!first) {
        throw new Error('Approval chain must include at least one stage');
    }
    return { status: 'PENDING_APPROVAL', approvalStep: first.id };
}
