import { parseOnboardingJson, parseEvaluationJson, VENDOR_CATEGORY_LABELS, } from '../lib/vendorOnboarding.js';
function parseScoringJson(raw) {
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function mapVendorOnboarding(row, opts) {
    const status = row.status;
    const includeScoring = opts?.includeScoring === true ||
        (opts?.role != null &&
            ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'HR_HEAD'].includes(opts.role));
    const category = row.category ?? null;
    const scoring = includeScoring ? parseScoringJson(row.scoringJson) : undefined;
    return {
        id: row.id,
        vendorId: row.vendorId,
        status,
        onboarding: parseOnboardingJson(row.onboardingJson),
        onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
        evaluation: parseEvaluationJson(row.evaluationJson),
        evaluationCompletedAt: row.evaluationCompletedAt?.toISOString() ?? null,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        submittedBy: row.submittedBy ?? null,
        ...(includeScoring
            ? {
                scoring: scoring ?? null,
                overallPercentage: row.overallPercentage ?? null,
                category,
                categoryLabel: category ? VENDOR_CATEGORY_LABELS[category] : null,
            }
            : {}),
        evaluator: {
            strengths: row.evaluatorStrengths ?? null,
            improvements: row.evaluatorImprovements ?? null,
            risks: row.evaluatorRisks ?? null,
            recommendation: row.evaluatorRecommendation ?? null,
        },
        decision: {
            status: status === 'APPROVED' || status === 'REJECTED' ? status : null,
            reason: row.decisionReason ?? null,
            decidedBy: row.decidedBy ?? null,
            decidedByName: row.decidedByName ?? null,
            decidedByRole: row.decidedByRole ?? null,
            decidedAt: row.decidedAt?.toISOString() ?? null,
        },
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
/** Slim status payload for portal gate / list badges (never includes scoring). */
export function mapVendorOnboardingStatus(row) {
    if (!row)
        return null;
    return {
        id: row.id,
        vendorId: row.vendorId,
        status: row.status,
        onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
        evaluationCompletedAt: row.evaluationCompletedAt?.toISOString() ?? null,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        decisionReason: row.decisionReason ?? null,
        decidedAt: row.decidedAt?.toISOString() ?? null,
    };
}
