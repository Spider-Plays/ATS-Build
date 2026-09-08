import { Router } from 'express';
import { z } from 'zod';
import { getDropdownCatalogs, resetDropdownCatalogs, setDropdownCatalogs, } from '../lib/dropdownCatalogSettings.js';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { INTERNAL_ROLES } from '../lib/roles.js';
const router = Router();
const labeledOptionSchema = z.object({
    value: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
});
const cityOptionSchema = z.object({
    city: z.string().min(2).max(120),
    state: z.string().max(120).nullable().optional(),
});
const catalogsSchema = z.object({
    cities: z.array(cityOptionSchema).min(1),
    candidateSources: z.array(z.string().min(1).max(120)).min(1),
    referralRelationships: z.array(z.string().min(1).max(120)).min(1),
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
router.put('/', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const body = catalogsSchema.parse(req.body);
    const catalogs = await setDropdownCatalogs(body, req.auth.userId);
    res.json(catalogs);
});
router.post('/reset-defaults', requireRoles('SUPER_ADMIN'), async (req, res) => {
    const catalogs = await resetDropdownCatalogs(req.auth.userId);
    res.json(catalogs);
});
export default router;
