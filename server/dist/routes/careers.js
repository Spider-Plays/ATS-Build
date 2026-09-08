import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { mapPublicCareersPosition, portalPositionsWhere, portalRequirementVisible, } from '../lib/portalPositions.js';
import { careersRateLimiter } from '../middleware/rateLimit.js';
const router = Router();
router.use(careersRateLimiter);
router.get('/positions', async (_req, res) => {
    const rows = await prisma.requirement.findMany({
        where: portalPositionsWhere(),
        orderBy: { updatedAt: 'desc' },
    });
    res.json(rows.filter(portalRequirementVisible).map(mapPublicCareersPosition));
});
router.get('/positions/departments', async (_req, res) => {
    const rows = await prisma.requirement.findMany({
        where: portalPositionsWhere(),
        orderBy: { updatedAt: 'desc' },
    });
    const departments = [
        ...new Set(rows.filter(portalRequirementVisible).map((r) => r.department)),
    ].sort();
    res.json(departments);
});
router.get('/positions/:id', async (req, res) => {
    const row = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!row || !portalRequirementVisible(row)) {
        return res.status(404).json({ error: 'Position not found or not available' });
    }
    res.json(mapPublicCareersPosition(row));
});
export default router;
