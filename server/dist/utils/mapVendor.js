export function mapVendor(v, ctx) {
    const hasOnboardingCtx = ctx != null && 'onboardingStatus' in ctx;
    const onboardingStatus = hasOnboardingCtx ? (ctx.onboardingStatus ?? null) : undefined;
    const onboardingApproved = hasOnboardingCtx
        ? onboardingStatus === null || onboardingStatus === 'APPROVED'
        : undefined;
    return {
        id: v.id,
        name: v.name,
        code: v.code ?? undefined,
        email: v.email,
        phone: v.phone ?? undefined,
        website: v.website ?? undefined,
        address: v.address ?? undefined,
        contactName: v.contactName ?? undefined,
        status: v.status,
        notes: v.notes ?? undefined,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
        userCount: ctx?.userCount,
        submissionCount: ctx?.submissionCount,
        assignmentCount: ctx?.assignmentCount,
        ...(hasOnboardingCtx
            ? {
                onboardingStatus: onboardingStatus ?? undefined,
                onboardingApproved,
            }
            : {}),
    };
}
