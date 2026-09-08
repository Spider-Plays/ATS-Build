import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { CONFIGURABLE_ROLES, PAGE_DEFINITIONS, PAGE_KEYS, getAllRolePageAccess, getAllowedPagesForRole, setRolePageAccess, defaultPagesForRole, sanitizePages, } from '../lib/pageAccess.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
router.get('/definitions', requireRoles('SUPER_ADMIN'), (_req, res) => {
    res.json({
        pages: PAGE_DEFINITIONS,
        roles: CONFIGURABLE_ROLES,
    });
});
router.get('/me', async (req, res) => {
    const pages = await getAllowedPagesForRole(req.auth.role);
    res.json({ role: req.auth.role, pages });
});
router.get('/', requireRoles('SUPER_ADMIN'), async (_req, res) => {
    const access = await getAllRolePageAccess();
    res.json({ access, pages: PAGE_DEFINITIONS, roles: CONFIGURABLE_ROLES });
});
router.put('/:role', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const role = z
        .enum(CONFIGURABLE_ROLES)
        .parse(req.params.role);
    const body = z
        .object({
        pages: z.array(z.enum(PAGE_KEYS)).min(1),
    })
        .parse(req.body);
    const pages = await setRolePageAccess(role, sanitizePages(body.pages));
    res.json({ role, pages });
});
router.post('/:role/reset', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const role = z.enum(CONFIGURABLE_ROLES).parse(req.params.role);
    const pages = await setRolePageAccess(role, defaultPagesForRole(role));
    res.json({ role, pages });
});
export default router;
