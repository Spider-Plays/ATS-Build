import { prisma } from './prisma.js';
import { CONFIGURABLE_ROLES, defaultPagesForRole, sanitizePagesForRole, } from './pageAccess.js';
function parsePagesJson(raw) {
    try {
        const arr = JSON.parse(raw || '[]');
        if (!Array.isArray(arr))
            return [];
        return arr.filter((p) => typeof p === 'string');
    }
    catch {
        return [];
    }
}
/** Ensures newly added default pages appear on existing RolePageAccess rows. */
export async function ensureRolePageAccessPatches() {
    const extraPages = {
        ACCOUNT_MANAGER: ['requirements', 'reports', 'self_service'],
        HIRING_MANAGER: ['requirements', 'reports', 'self_service'],
        HR_HEAD: ['reports', 'self_service'],
        HR_MANAGER: ['reports', 'self_service'],
        FINANCE_HEAD: ['self_service'],
        RECRUITER: ['reports', 'self_service'],
        TEAM_LEAD: ['reports', 'self_service'],
        INTERVIEWER: ['self_service'],
    };
    for (const role of CONFIGURABLE_ROLES) {
        if (role === 'SUPER_ADMIN')
            continue;
        const defaults = defaultPagesForRole(role);
        const row = await prisma.rolePageAccess.findUnique({ where: { role } });
        const stored = row ? parsePagesJson(row.pages) : [];
        const base = stored.length > 0 ? stored : defaults;
        const merged = sanitizePagesForRole(role, [
            ...new Set([...base, ...defaults, ...(extraPages[role] ?? [])]),
        ]);
        if (merged.length === base.length && merged.every((p) => base.includes(p))) {
            continue;
        }
        await prisma.rolePageAccess.upsert({
            where: { role },
            create: { role, pages: JSON.stringify(merged) },
            update: { pages: JSON.stringify(merged) },
        });
        console.log(`[startup] Patched RolePageAccess for ${role}: ${merged.join(', ')}`);
    }
}
