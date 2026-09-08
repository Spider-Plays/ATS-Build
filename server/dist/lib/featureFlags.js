import { prisma } from './prisma.js';
export const FEATURE_FLAG_KEYS = [
    'dashboard', 'businessRequirements', 'requirements', 'candidates', 'candidateSearch',
    'pipeline', 'interviews', 'offers', 'vendors', 'reports', 'hiringReport', 'taReport',
    'referralReport', 'vendorReport', 'marketTrends', 'offerCompensationConfig',
    'offerLetterTemplate', 'admin', 'adminUsers', 'adminDepartments', 'adminClients',
    'adminSkills', 'adminDropdowns', 'adminInterviewPanels', 'adminRoleAccess',
    'adminFeatureFlags', 'selfService', 'changeRequests', 'taProcess', 'policies', 'training',
    'candidatePortal', 'vendorPortal', 'referralPortal', 'careersPage', 'featureCareers',
    'featureEmployeeReferral', 'featureVendorSubmission', 'featureMis', 'aiAssistant',
    'notifications', 'settings', 'feedback', 'requirementApproval', 'offerApproval',
];
export const DEFAULT_FEATURE_FLAGS = Object.fromEntries(FEATURE_FLAG_KEYS.map((key) => [key, true]));
const SETTING_KEY = 'feature_flags';
export async function getFeatureFlags() {
    const setting = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!setting)
        return { ...DEFAULT_FEATURE_FLAGS };
    try {
        const stored = JSON.parse(setting.value);
        return {
            ...DEFAULT_FEATURE_FLAGS,
            ...Object.fromEntries(FEATURE_FLAG_KEYS
                .filter((key) => typeof stored[key] === 'boolean')
                .map((key) => [key, stored[key]])),
        };
    }
    catch {
        return { ...DEFAULT_FEATURE_FLAGS };
    }
}
export async function saveFeatureFlags(flags, updatedBy) {
    const current = await getFeatureFlags();
    const next = {
        ...current,
        ...Object.fromEntries(FEATURE_FLAG_KEYS
            .filter((key) => typeof flags[key] === 'boolean')
            .map((key) => [key, flags[key]])),
    };
    await prisma.appSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: JSON.stringify(next), updatedBy },
        update: { value: JSON.stringify(next), updatedBy },
    });
    return next;
}
