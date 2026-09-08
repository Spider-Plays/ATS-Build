import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ensureDefaultDepartmentCatalog, invalidateDepartmentCatalogCache, listDepartmentCatalog, } from '../lib/departmentCatalog.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { INTERNAL_ROLES } from '../lib/roles.js';
import { CatalogHandlers } from '../lib/catalogRouteFactory.js';
const router = Router();
// Create reusable handlers
const handlers = new CatalogHandlers({
    entityName: 'department',
    prismaModel: prisma.departmentCatalog,
    invalidateCache: invalidateDepartmentCatalogCache,
    listItems: listDepartmentCatalog,
    resetDefaults: ensureDefaultDepartmentCatalog,
});
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
router.get('/', handlers.list);
router.post('/', requireRoles('ADMIN'), handlers.create);
router.delete('/:id', requireRoles('ADMIN'), handlers.delete);
router.post('/seed-defaults', requireRoles('ADMIN'), handlers.seedDefaults);
export default router;
