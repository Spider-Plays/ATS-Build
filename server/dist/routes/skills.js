import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { invalidateSkillCatalogCache, listSkillCatalog, resetDefaultSkillCatalogSync, syncDefaultSkillCatalog, } from '../lib/skillCatalog.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { INTERNAL_ROLES } from '../lib/roles.js';
import { CatalogHandlers } from '../lib/catalogRouteFactory.js';
const router = Router();
// Extend handlers with custom create logic for skills with category
class SkillHandlers extends CatalogHandlers {
    create = async (req, res) => {
        try {
            const body = z
                .object({
                name: z.string().min(2).max(80),
                category: z.string().max(40).optional(),
            })
                .parse(req.body);
            const name = body.name.trim().replace(/\s+/g, ' ');
            // Check for existing item
            const existing = await prisma.skillCatalog.findFirst({
                where: { name: { equals: name, mode: 'insensitive' } },
            });
            if (existing) {
                return res.status(409).json({
                    error: 'This skill already exists',
                    skill: existing,
                });
            }
            // Create with category
            const row = await prisma.skillCatalog.create({
                data: {
                    name,
                    category: body.category?.trim() || 'General',
                },
            });
            invalidateSkillCatalogCache();
            res.status(201).json(row);
        }
        catch (error) {
            if (error.name === 'ZodError') {
                return res.status(400).json({ error: 'Invalid request body', details: error.errors });
            }
            res.status(500).json({ error: 'Failed to create skill' });
        }
    };
}
const handlers = new SkillHandlers({
    entityName: 'skill',
    prismaModel: prisma.skillCatalog,
    invalidateCache: invalidateSkillCatalogCache,
    listItems: listSkillCatalog,
    resetDefaults: resetDefaultSkillCatalogSync,
    syncDefaults: syncDefaultSkillCatalog,
});
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
router.get('/', handlers.list);
router.post('/', requireRoles('ADMIN'), handlers.create);
router.delete('/:id', requireRoles('ADMIN'), handlers.delete);
router.post('/seed-defaults', requireRoles('ADMIN'), handlers.seedDefaults);
export default router;
