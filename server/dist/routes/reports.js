import { Router } from 'express';
import { requireAuth, requireActiveUser, requireRoles } from '../middleware/auth.js';
import { CHANNEL_REPORT_ROLES, HIRING_REPORT_ROLES, TA_REPORT_ROLES, } from '../lib/roles.js';
import { buildTaReport, normalizePreset, parseMonthFilters, parseQuarterFilters, parseReportDayRanges, parseRequirementStatuses, resolveDateRange, } from '../lib/taReport.js';
import { buildHiringReport } from '../lib/hiringReport.js';
import { buildReferralReport } from '../lib/referralReport.js';
import { buildVendorReport } from '../lib/vendorReport.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
function parseHiringGroupBy(value) {
    if (value === 'department' || value === 'hiringManager' || value === 'accountManager') {
        return value;
    }
    return 'client';
}
function parseReferralGroupBy(value) {
    if (value === 'department' || value === 'client')
        return value;
    return 'referrer';
}
function parseVendorGroupBy(value) {
    return value === 'client' ? 'client' : 'vendor';
}
router.get('/ta', requireRoles(...TA_REPORT_ROLES), async (req, res) => {
    const groupBy = req.query.groupBy === 'recruiter' ? 'recruiter' : 'client';
    const preset = normalizePreset(req.query.preset);
    const { from, to } = resolveDateRange(preset, req.query.from, req.query.to);
    const ranges = parseReportDayRanges(req.query.ranges);
    const statuses = parseRequirementStatuses(req.query.status);
    const quarters = parseQuarterFilters(req.query.quarter);
    const months = parseMonthFilters(req.query.month);
    const report = await buildTaReport(req.auth, {
        groupBy,
        from,
        to,
        ranges: ranges.length > 0 ? ranges : undefined,
        statuses,
        quarters,
        months,
    });
    res.json({
        groupBy,
        preset,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        rows: report.rows,
        total: report.total,
    });
});
router.get('/hiring', requireRoles(...HIRING_REPORT_ROLES), async (req, res) => {
    try {
        const groupBy = parseHiringGroupBy(req.query.groupBy);
        const preset = normalizePreset(req.query.preset);
        const { from, to } = resolveDateRange(preset, req.query.from, req.query.to);
        const report = await buildHiringReport({ groupBy, from, to });
        res.json({
            groupBy,
            preset,
            from: from ? from.toISOString() : null,
            to: to ? to.toISOString() : null,
            rows: report.rows,
            total: report.total,
        });
    }
    catch (err) {
        console.error('[reports/hiring]', err);
        res.status(500).json({ error: 'Failed to build hiring report' });
    }
});
router.get('/referrals', requireRoles(...CHANNEL_REPORT_ROLES), async (req, res) => {
    try {
        const groupBy = parseReferralGroupBy(req.query.groupBy);
        const preset = normalizePreset(req.query.preset);
        const { from, to } = resolveDateRange(preset, req.query.from, req.query.to);
        const report = await buildReferralReport({ groupBy, from, to });
        res.json({
            groupBy,
            preset,
            from: from ? from.toISOString() : null,
            to: to ? to.toISOString() : null,
            rows: report.rows,
            total: report.total,
        });
    }
    catch (err) {
        console.error('[reports/referrals]', err);
        res.status(500).json({ error: 'Failed to build referral report' });
    }
});
router.get('/vendors', requireRoles(...CHANNEL_REPORT_ROLES), async (req, res) => {
    try {
        const groupBy = parseVendorGroupBy(req.query.groupBy);
        const preset = normalizePreset(req.query.preset);
        const { from, to } = resolveDateRange(preset, req.query.from, req.query.to);
        const report = await buildVendorReport({ groupBy, from, to });
        res.json({
            groupBy,
            preset,
            from: from ? from.toISOString() : null,
            to: to ? to.toISOString() : null,
            rows: report.rows,
            total: report.total,
        });
    }
    catch (err) {
        console.error('[reports/vendors]', err);
        res.status(500).json({ error: 'Failed to build vendor report' });
    }
});
export default router;
