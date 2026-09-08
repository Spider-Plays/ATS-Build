import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { ensureDefaultClientCatalog, invalidateClientCatalogCache, listClientCatalog, } from '../lib/clientCatalog.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { REQUIREMENT_API_ROLES } from '../lib/roles.js';
import { BUSINESS_MUTATE_ROLES } from '../lib/businessRequirementAccess.js';
import { CatalogHandlers } from '../lib/catalogRouteFactory.js';
const router = Router();
// Create reusable handlers
const handlers = new CatalogHandlers({
    entityName: 'client',
    prismaModel: prisma.clientCatalog,
    invalidateCache: invalidateClientCatalogCache,
    listItems: listClientCatalog,
    resetDefaults: ensureDefaultClientCatalog,
});
router.use(requireAuth, requireActiveUser);
router.get('/', requireRoles(...REQUIREMENT_API_ROLES), handlers.list);
router.post('/', requireRoles(...BUSINESS_MUTATE_ROLES), handlers.create);
router.delete('/:id', requireRoles('ADMIN'), handlers.delete);
router.post('/seed-defaults', requireRoles('ADMIN'), handlers.seedDefaults);
export default router;
