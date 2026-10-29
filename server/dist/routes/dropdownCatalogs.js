import { Router } from 'express';
import { z } from 'zod';
import { catalogText } from '../lib/catalogRouteFactory.js';
import { getDropdownCatalogs, resetDropdownCatalogs, setDropdownCatalogs, } from '../lib/dropdownCatalogSettings.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { INTERNAL_ROLES } from '../lib/roles.js';
const router = Router();
const labeledOptionSchema = z.object({
    value: catalogText(1, 80, 'Value'),
    label: catalogText(1, 120, 'Label'),
});
const cityOptionSchema = z.object({
    city: catalogText(2, 120, 'City'),
    state: catalogText(0, 120, 'State').nullable().optional(),
});
const catalogsSchema = z.object({
    cities: z.array(cityOptionSchema).min(1),
    candidateSources: z.array(catalogText(1, 120, 'Option')).min(1),
    referralRelationships: z.array(catalogText(1, 120, 'Option')).min(1),
    employmentTypes: z.array(labeledOptionSchema).min(1),
    workModes: z.array(labeledOptionSchema).min(1),
    seniorityLevels: z.array(labeledOptionSchema).min(1),
    requirementPriorities: z.array(labeledOptionSchema).min(1),
    businessTypes: z.array(labeledOptionSchema).min(1),
    domains: z.array(labeledOptionSchema).min(1),
    jobTypes: z.array(labeledOptionSchema).min(1),
    employmentChannels: z.array(labeledOptionSchema).min(1),
    requirementForOptions: z.array(labeledOptionSchema).min(1),
    hireCategories: z.array(labeledOptionSchema).min(1),
    educationOptions: z.array(labeledOptionSchema).min(1),
});
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
router.get('/', async (_req, res) => {
    const catalogs = await getDropdownCatalogs();
    res.json(catalogs);
});
router.put('/', requireRoles('ADMIN'), async (req, res) => {
    const body = catalogsSchema.parse(req.body);
    const catalogs = await setDropdownCatalogs(body, req.auth.userId);
    res.json(catalogs);
});
router.post('/reset-defaults', requireRoles('ADMIN'), async (req, res) => {
    const catalogs = await resetDropdownCatalogs(req.auth.userId);
    res.json(catalogs);
});
export default router;
