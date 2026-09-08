import { Router } from 'express';
import { requireAuth, requireActiveUser } from '../middleware/auth.js';
import { EXPERIENCE_BANDS, canEditMarketData, createSkillMarketRow, deleteSkillMarketRow, listMarketTrends, parseBands, replaceLocationMultipliers, resolveCanEditMarketData, updateSkillMarketRow, userCanAccessMarketTrendsPage, userCanReadMarketTrends, } from '../lib/marketTrends.js';
import { parseFeatureTags } from '../lib/userTags.js';
import { prisma } from '../lib/prisma.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
async function requireMarketTrendsRead(req, res, next) {
    const role = req.auth.role;
    const ok = await userCanReadMarketTrends(role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    next();
}
async function requireMarketTrendsPage(req, res, next) {
    const role = req.auth.role;
    const ok = await userCanAccessMarketTrendsPage(role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    next();
}
async function requireMarketDataEdit(req, res, next) {
    const canEdit = await resolveCanEditMarketData(req.auth.userId, req.auth.role);
    if (!canEdit)
        return res.status(403).json({ error: 'Forbidden' });
    next();
}
function parseSkillBody(body) {
    if (!body || typeof body !== 'object')
        return { error: 'Invalid body' };
    const b = body;
    const capabilityArea = String(b.capabilityArea ?? '').trim();
    const framework = String(b.framework ?? '').trim();
    const scriptingLanguage = String(b.scriptingLanguage ?? '').trim();
    const toolsTechnologies = String(b.toolsTechnologies ?? '').trim();
    if (!capabilityArea || !framework || !scriptingLanguage || !toolsTechnologies) {
        return { error: 'Capability, framework, language, and tools are required' };
    }
    const bands = parseBands(b.bands);
    if (!bands) {
        return {
            error: `bands must include exactly ${EXPERIENCE_BANDS.length} experience bands with minCtc/maxCtc`,
        };
    }
    const sortOrder = b.sortOrder == null ? undefined : Number(b.sortOrder);
    if (sortOrder != null && !Number.isFinite(sortOrder))
        return { error: 'Invalid sortOrder' };
    return { capabilityArea, framework, scriptingLanguage, toolsTechnologies, bands, sortOrder };
}
router.get('/', requireMarketTrendsRead, async (req, res) => {
    const data = await listMarketTrends();
    const user = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { permissions: true, role: true },
    });
    const tags = parseFeatureTags(user?.permissions);
    const canEdit = canEditMarketData(user?.role ?? req.auth.role, tags);
    res.json({ ...data, canEdit, experienceBands: [...EXPERIENCE_BANDS] });
});
router.post('/skills', requireMarketTrendsPage, requireMarketDataEdit, async (req, res) => {
    const parsed = parseSkillBody(req.body);
    if ('error' in parsed)
        return res.status(400).json({ error: parsed.error });
    const row = await createSkillMarketRow(parsed);
    res.status(201).json(row);
});
router.put('/skills/:id', requireMarketTrendsPage, requireMarketDataEdit, async (req, res) => {
    const parsed = parseSkillBody(req.body);
    if ('error' in parsed)
        return res.status(400).json({ error: parsed.error });
    const row = await updateSkillMarketRow(req.params.id, parsed);
    if (!row)
        return res.status(404).json({ error: 'Skill row not found' });
    res.json(row);
});
router.delete('/skills/:id', requireMarketTrendsPage, requireMarketDataEdit, async (req, res) => {
    const ok = await deleteSkillMarketRow(req.params.id);
    if (!ok)
        return res.status(404).json({ error: 'Skill row not found' });
    res.json({ ok: true });
});
router.put('/locations', requireMarketTrendsPage, requireMarketDataEdit, async (req, res) => {
    const raw = req.body?.locations;
    if (!Array.isArray(raw) || raw.length === 0) {
        return res.status(400).json({ error: 'locations array is required' });
    }
    const rows = [];
    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (!item || typeof item !== 'object') {
            return res.status(400).json({ error: `Invalid location at index ${i}` });
        }
        const location = String(item.location ?? '').trim();
        const multiplier = Number(item.multiplier);
        if (!location)
            return res.status(400).json({ error: `Location name required at index ${i}` });
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
            return res.status(400).json({ error: `Multiplier must be > 0 at index ${i}` });
        }
        const sortOrder = item.sortOrder;
        rows.push({
            location,
            multiplier,
            sortOrder: sortOrder == null ? i + 1 : Number(sortOrder),
        });
    }
    const locations = await replaceLocationMultipliers(rows);
    res.json({ locations });
});
export default router;
