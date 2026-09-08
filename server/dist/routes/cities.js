import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { formatCityName, invalidateCityCatalogCache, listCityCatalog, syncDefaultCityCatalog, } from '../lib/cityCatalog.js';
import { getDropdownCatalogs } from '../lib/dropdownCatalogSettings.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
router.get('/', async (_req, res) => {
    try {
        const cities = await listCityCatalog();
        if (cities.length > 0)
            return res.json(cities);
    }
    catch {
        // Fall back to AppSetting-backed catalog when CityCatalog table is unavailable.
    }
    const catalogs = await getDropdownCatalogs();
    res.json(catalogs.cities.map((row, index) => ({
        id: `catalog-city-${index}`,
        city: row.city,
        state: row.state ?? null,
    })));
});
router.post('/', async (req, res) => {
    const body = z
        .object({
        city: z.string().min(2).max(120),
        state: z.string().max(120).optional(),
    })
        .parse(req.body);
    const city = formatCityName(body.city);
    const state = body.state?.trim() || null;
    const existing = await prisma.cityCatalog.findFirst({
        where: { city: { equals: city, mode: 'insensitive' } },
    });
    if (existing) {
        return res.status(409).json({ error: 'This city already exists', city: existing });
    }
    const row = await prisma.cityCatalog.create({
        data: { city, state },
    });
    invalidateCityCatalogCache();
    res.status(201).json(row);
});
router.patch('/:id', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const body = z
        .object({
        city: z.string().min(2).max(120).optional(),
        state: z.string().max(120).nullable().optional(),
    })
        .parse(req.body);
    const row = await prisma.cityCatalog.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'City not found' });
    const city = body.city ? formatCityName(body.city) : row.city;
    const state = body.state !== undefined ? body.state?.trim() || null : row.state;
    if (city.toLowerCase() !== row.city.toLowerCase()) {
        const duplicate = await prisma.cityCatalog.findFirst({
            where: {
                city: { equals: city, mode: 'insensitive' },
                NOT: { id: row.id },
            },
        });
        if (duplicate) {
            return res.status(409).json({ error: 'This city already exists', city: duplicate });
        }
    }
    const updated = await prisma.cityCatalog.update({
        where: { id: row.id },
        data: { city, state },
    });
    invalidateCityCatalogCache();
    res.json(updated);
});
router.delete('/:id', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const row = await prisma.cityCatalog.findUnique({ where: { id: req.params.id } });
    if (!row)
        return res.status(404).json({ error: 'City not found' });
    await prisma.cityCatalog.delete({ where: { id: row.id } });
    invalidateCityCatalogCache();
    res.status(204).send();
});
router.post('/seed-defaults', requireRoles('SUPER_ADMIN'), async (_req, res) => {
    const added = await syncDefaultCityCatalog();
    const cities = await listCityCatalog();
    res.json({ added, count: cities.length, cities });
});
export default router;
