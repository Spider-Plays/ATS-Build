import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { INTERNAL_ROLES } from '../lib/roles.js';
import { getCompensationConfig, setCompensationConfig, getOfferLetterTemplate, setOfferLetterTemplate, } from '../lib/offerSettings.js';
import { calculateCompensationBreakdown, DEFAULT_COMPENSATION_CONFIG, } from '../lib/offerCompensation.js';
import { renderOfferLetterHtml } from '../lib/offerLetterRender.js';
import { mergeOfferLetterTemplate } from '../lib/offerLetterTemplate.js';
const router = Router();
router.use(requireAuth, requireActiveUser, requireRoles(...INTERNAL_ROLES));
const COMPENSATION_EDITORS = ['FINANCE_HEAD', 'SUPER_ADMIN', 'ADMIN'];
const LETTER_TEMPLATE_EDITORS = ['HR_HEAD', 'SUPER_ADMIN', 'ADMIN'];
const compensationSchema = z.object({
    basicPercentOfCtc: z.number().min(1).max(100),
    hraPercentOfBasic: z.number().min(0).max(100),
    statBonusPercentOfBasic: z.number().min(0).max(100),
    ltaPercentOfBasic: z.number().min(0).max(100),
    mealAllowanceAnnual: z.number().min(0),
    mobileAllowanceAnnual: z.number().min(0),
    siteAllowanceAnnual: z.number().min(0),
    employerPfPercentOfBasic: z.number().min(0).max(100),
    pfAdminPercentOfBasic: z.number().min(0).max(100),
    insuranceAnnual: z.number().min(0),
    employerLwfAnnual: z.number().min(0),
    employeeLwfAnnual: z.number().min(0),
});
const orgSettingsSchema = z.object({
    legalEntityName: z.string(),
    returnAddress: z.string(),
    timesheetAddress: z.string(),
    reportingTime: z.string(),
    acceptanceDeadlineDays: z.number().int().min(1).max(90),
    annualLeaveDays: z.number().int().min(0).max(365),
    noticePeriodDays: z.number().int().min(0).max(180),
    reviewPeriodMonths: z.number().int().min(1).max(60),
});
const letterTemplateSchema = z.object({
    orgSettings: orgSettingsSchema,
    coverPageHtml: z.string().min(1),
    agreementIntroHtml: z.string().min(1),
    clausePages: z.array(z.string()).min(1),
    declarationPageHtml: z.string().min(1),
});
router.get('/compensation', requireRoles(...COMPENSATION_EDITORS, ...LETTER_TEMPLATE_EDITORS, 'HR_MANAGER', 'TEAM_LEAD'), async (_req, res) => {
    const config = await getCompensationConfig();
    res.json(config);
});
router.put('/compensation', requireRoles(...COMPENSATION_EDITORS), async (req, res) => {
    const body = compensationSchema.parse(req.body);
    const saved = await setCompensationConfig({ ...DEFAULT_COMPENSATION_CONFIG, ...body }, req.auth.userId);
    res.json(saved);
});
router.post('/compensation/preview', requireRoles(...COMPENSATION_EDITORS), async (req, res) => {
    const annualCtc = Number(req.body.annualCtc);
    if (!annualCtc || annualCtc < 1000) {
        return res.status(400).json({ error: 'annualCtc must be at least 1000' });
    }
    const config = req.body.config
        ? compensationSchema.parse(req.body.config)
        : await getCompensationConfig();
    res.json(calculateCompensationBreakdown(annualCtc, { ...DEFAULT_COMPENSATION_CONFIG, ...config }));
});
router.get('/letter-template', requireRoles(...LETTER_TEMPLATE_EDITORS, 'HR_MANAGER'), async (_req, res) => {
    const template = await getOfferLetterTemplate();
    res.json(template);
});
router.put('/letter-template', requireRoles(...LETTER_TEMPLATE_EDITORS), async (req, res) => {
    const body = letterTemplateSchema.parse(req.body);
    const saved = await setOfferLetterTemplate(body, req.auth.userId);
    res.json(saved);
});
router.post('/letter-template/preview', requireRoles(...LETTER_TEMPLATE_EDITORS), async (req, res) => {
    const template = req.body.template
        ? mergeOfferLetterTemplate(letterTemplateSchema.parse(req.body.template))
        : await getOfferLetterTemplate();
    const annualCtc = Number(req.body.annualCtc) || 960000;
    const config = await getCompensationConfig();
    const breakdown = calculateCompensationBreakdown(annualCtc, config);
    const joiningDate = new Date(Date.now() + 14 * 86400000);
    const html = renderOfferLetterHtml({
        candidateName: 'Sample Candidate',
        candidateAddress: '123 Sample Street, Bengaluru, Karnataka 560001',
        positionTitle: 'Software Engineer',
        joiningDate,
        clientCompanyName: 'Sample Client Pvt Ltd',
        clientSiteAddress: 'Tech Park, Outer Ring Road, Bengaluru',
        reportingTime: template.orgSettings.reportingTime,
        annualCtc,
        breakdown,
        template,
    });
    res.type('html').send(html);
});
router.post('/letter-template/reset', requireRoles(...LETTER_TEMPLATE_EDITORS), async (req, res) => {
    const saved = await setOfferLetterTemplate(mergeOfferLetterTemplate(null), req.auth.userId);
    res.json(saved);
});
export default router;
