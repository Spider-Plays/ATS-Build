/** Shared helpers for detailed analytics reports (Hiring / Referral / Vendor). */
export function dateValue(date) {
    return date ? date.toISOString() : undefined;
}
export function inDateRange(date, from, to) {
    if (!date)
        return false;
    if (from && date < from)
        return false;
    if (to && date > to)
        return false;
    return true;
}
export function submissionDate(c) {
    return c.submittedAt ?? c.appliedDate;
}
export function isSubmission(c) {
    return !!c.requirementId;
}
export function isToBeScreened(status) {
    return (status === 'TO_BE_SCREENED' ||
        status === 'SCREENING' ||
        status === 'SUBMITTED' ||
        status === 'ADDED' ||
        status === 'SOURCED' ||
        status === 'APPLIED');
}
const SELECTION_STATUSES = new Set(['HR_INTERVIEW_SELECT', 'TO_BE_OFFERED']);
const OFFER_STATUSES = new Set(['OFFERED', 'OFFER_ACCEPTED']);
const REJECT_STATUSES = new Set([
    'SCREEN_REJECT',
    'L1_INTERVIEW_REJECT',
    'MANAGERIAL_INTERVIEW_REJECT',
    'CLIENT_INTERVIEW_REJECT',
    'HR_INTERVIEW_REJECT',
    'POSITION_ABORT',
    'CANDIDATE_ABORT',
]);
export function isSelection(status) {
    return SELECTION_STATUSES.has(status);
}
export function isOfferStage(status) {
    return OFFER_STATUSES.has(status);
}
export function isJoined(status) {
    return status === 'JOINED' || status === 'HIRED';
}
export function isRejected(status) {
    return REJECT_STATUSES.has(status);
}
export function isDeclined(status) {
    return status === 'OFFER_DECLINED';
}
export function isOnHoldReq(status, hiringStage) {
    return status === 'ON_HOLD' || hiringStage === 'ON_HOLD';
}
export function isClosedReq(status) {
    return status === 'CLOSED' || status === 'CANCELLED' || status === 'FILLED';
}
export function pct(numerator, denominator) {
    if (denominator <= 0)
        return 0;
    return Math.round((numerator / denominator) * 1000) / 10;
}
export function avg(sum, count) {
    if (count <= 0)
        return 0;
    return Math.round((sum / count) * 10) / 10;
}
export function daysBetween(from, to) {
    return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}
/** IST calendar-day difference (matches requirement ageing in the product UI). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
export function calendarDaysBetween(from, to) {
    const a = new Date(from.getTime() + IST_OFFSET_MS);
    const b = new Date(to.getTime() + IST_OFFSET_MS);
    const start = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
    return Math.round((end - start) / 86_400_000);
}
/** Days in a hold window that pause active sourcing age. */
export function computeHoldPausedDays(holdStartDate, holdEndDate, now = new Date()) {
    if (!holdStartDate)
        return 0;
    const start = holdStartDate;
    const endRaw = holdEndDate ?? now;
    const end = endRaw.getTime() > now.getTime() ? now : endRaw;
    if (end.getTime() < start.getTime())
        return 0;
    return Math.max(0, calendarDaysBetween(start, end));
}
export function computeRequirementAgeSnapshot(r, now = new Date()) {
    const end = r.closedAt && r.closedAt.getTime() <= now.getTime() ? r.closedAt : now;
    // SLA / product ageing starts on approval (liveAt), not on draft creation.
    const ageStart = r.liveAt ?? r.createdAt;
    const totalAgeDays = r.liveAt
        ? Math.max(0, calendarDaysBetween(r.liveAt, end))
        : r.status === 'LIVE' || r.status === 'ON_HOLD' || r.status === 'APPROVED'
            ? Math.max(0, calendarDaysBetween(ageStart, end))
            : 0;
    const holdPausedDays = computeHoldPausedDays(r.holdStartDate, r.holdEndDate, end);
    let activeAgeDays = null;
    if (r.liveAt) {
        activeAgeDays = Math.max(0, calendarDaysBetween(r.liveAt, end) - holdPausedDays);
    }
    else if (r.status === 'LIVE' || r.status === 'ON_HOLD') {
        activeAgeDays = Math.max(0, totalAgeDays - holdPausedDays);
    }
    let overdue = false;
    if (r.hiringDeadline && !r.closedAt && r.status !== 'CLOSED' && r.status !== 'CANCELLED') {
        overdue = calendarDaysBetween(now, r.hiringDeadline) < 0;
    }
    return { totalAgeDays, activeAgeDays, holdPausedDays, overdue };
}
export function finalizeNameMap(map) {
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export const UNASSIGNED = 'Unassigned';
