import { prisma } from './prisma.js';
export const DEFAULT_PANEL_LEVELS = [
    { order: 0, name: 'L1 Interview' },
    { order: 1, name: 'Managerial Interview' },
    { order: 2, name: 'HR Interview' },
];
function mapLevel(row) {
    return {
        id: row.id,
        order: row.order,
        name: row.name,
        interviewerIds: JSON.parse(row.interviewerIds || '[]'),
    };
}
export async function ensureInterviewPanelCatalog() {
    for (const level of DEFAULT_PANEL_LEVELS) {
        const existing = await prisma.interviewPanelLevel.findUnique({
            where: { order: level.order },
        });
        if (!existing) {
            await prisma.interviewPanelLevel.create({
                data: { order: level.order, name: level.name },
            });
        }
    }
}
export async function listInterviewPanelLevels() {
    await ensureInterviewPanelCatalog();
    const rows = await prisma.interviewPanelLevel.findMany({ orderBy: { order: 'asc' } });
    return rows.map(mapLevel);
}
export async function getPanelInterviewerIdsByOrder(order) {
    await ensureInterviewPanelCatalog();
    const row = await prisma.interviewPanelLevel.findUnique({ where: { order } });
    if (!row)
        return [];
    return JSON.parse(row.interviewerIds || '[]');
}
export async function syncPanelToAllPlanStages(order, interviewerIds) {
    const payload = JSON.stringify(interviewerIds);
    await prisma.interviewPlanStage.updateMany({
        where: { order },
        data: { defaultInterviewerIds: payload },
    });
}
export const DEFAULT_PANEL_STAGE_COUNT = DEFAULT_PANEL_LEVELS.length;
/** Stages beyond L1 / L2 / HR use the combined panel pool. */
export function isAdditionalPlanStageOrder(order) {
    return order >= DEFAULT_PANEL_STAGE_COUNT;
}
export async function getAllPanelInterviewerIds() {
    const levels = await listInterviewPanelLevels();
    const ids = new Set();
    for (const level of levels) {
        for (const id of level.interviewerIds) {
            if (typeof id === 'string' && id.trim())
                ids.add(id);
        }
    }
    return [...ids];
}
/**
 * Who may interview a stage:
 * - L1 (0): L1 ∪ Managerial ∪ HR panels
 * - L2 (1): Managerial ∪ HR panels
 * - HR (2): HR panel only
 * - Extra stages: combined pool
 *
 * Panel membership rules: L1-only, Managerial=L1+L2, HR=all levels.
 */
export async function getAllowedInterviewerIdsForPlanStageOrder(order) {
    if (isAdditionalPlanStageOrder(order)) {
        return getAllPanelInterviewerIds();
    }
    const levels = await listInterviewPanelLevels();
    const ids = new Set();
    for (const level of levels) {
        if (level.order < order || level.order >= DEFAULT_PANEL_STAGE_COUNT)
            continue;
        for (const id of level.interviewerIds) {
            if (typeof id === 'string' && id.trim())
                ids.add(id);
        }
    }
    return [...ids];
}
export function panelRestrictionLabel(order, stageName) {
    if (isAdditionalPlanStageOrder(order)) {
        return 'combined interview panel';
    }
    if (order <= 0)
        return 'L1, Managerial, or HR interview panel';
    if (order === 1)
        return 'Managerial or HR interview panel';
    if (order === 2)
        return 'HR interview panel';
    const match = DEFAULT_PANEL_LEVELS.find((l) => l.order === order);
    return match?.name ?? stageName;
}
/** Short capability text for Admin → Interview panels columns. */
export function panelCapabilityLabel(panelOrder) {
    if (panelOrder <= 0)
        return 'Can conduct L1 interviews only';
    if (panelOrder === 1)
        return 'Can conduct L1 and L2 / Managerial interviews';
    if (panelOrder === 2)
        return 'Can conduct all interview levels (L1, L2, HR)';
    return '';
}
export async function updateInterviewPanelLevel(levelId, interviewerIds) {
    const row = await prisma.interviewPanelLevel.findUnique({ where: { id: levelId } });
    if (!row)
        throw new Error('Interview panel level not found');
    const uniqueIds = [...new Set(interviewerIds.filter((id) => typeof id === 'string' && id.trim()))];
    const updated = await prisma.interviewPanelLevel.update({
        where: { id: levelId },
        data: { interviewerIds: JSON.stringify(uniqueIds) },
    });
    await syncPanelToAllPlanStages(updated.order, uniqueIds);
    return mapLevel(updated);
}
const PANEL_MEMBER_ROLES = new Set([
    'INTERVIEWER',
    'HIRING_MANAGER',
    'ACCOUNT_MANAGER',
    'TEAM_LEAD',
    'RECRUITER',
    'SUPER_ADMIN',
    'ADMIN',
    'HR_HEAD',
    'HR_MANAGER',
]);
const DEFAULT_PANEL_ROLE_HINTS = {
    0: ['INTERVIEWER', 'TEAM_LEAD', 'RECRUITER', 'HIRING_MANAGER'],
    1: ['HIRING_MANAGER', 'ACCOUNT_MANAGER', 'TEAM_LEAD', 'RECRUITER'],
    2: ['HR_MANAGER', 'HR_HEAD', 'ADMIN'],
};
/**
 * Fill empty L1/L2/HR panels with active staff (up to 3 each).
 * Set `force` to replace existing members.
 */
export async function configureDefaultInterviewPanels(opts) {
    const force = opts?.force ?? false;
    const perPanel = opts?.perPanel ?? 3;
    await ensureInterviewPanelCatalog();
    const levels = await listInterviewPanelLevels();
    const users = await prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, email: true, role: true },
    });
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    const eligible = users.filter((u) => PANEL_MEMBER_ROLES.has(u.role));
    if (eligible.length === 0)
        return levels;
    for (const level of levels) {
        if (level.interviewerIds.length > 0 && !force)
            continue;
        const picked = [];
        for (const email of opts?.preferredEmailsByOrder?.[level.order] ?? []) {
            const user = byEmail.get(email.toLowerCase());
            if (user && PANEL_MEMBER_ROLES.has(user.role) && !picked.includes(user.id)) {
                picked.push(user.id);
            }
        }
        for (const role of DEFAULT_PANEL_ROLE_HINTS[level.order] ?? []) {
            if (picked.length >= perPanel)
                break;
            for (const user of eligible.filter((u) => u.role === role)) {
                if (picked.length >= perPanel)
                    break;
                if (!picked.includes(user.id))
                    picked.push(user.id);
            }
        }
        for (const user of eligible) {
            if (picked.length >= perPanel)
                break;
            if (!picked.includes(user.id))
                picked.push(user.id);
        }
        if (picked.length > 0) {
            await updateInterviewPanelLevel(level.id, picked);
        }
    }
    return listInterviewPanelLevels();
}
