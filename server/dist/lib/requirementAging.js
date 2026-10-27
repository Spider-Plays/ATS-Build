import { calendarDaysBetween } from './reportCommon.js';
/** Calendar days since approval before orange flag / first alert. */
export const REQUIREMENT_AGING_ORANGE_DAYS = 20;
/** Calendar days since approval before red flag / second alert. */
export const REQUIREMENT_AGING_RED_DAYS = 40;
export const AGING_ALERT_20_ACTION = 'AGING_ALERT_20';
export const AGING_ALERT_40_ACTION = 'AGING_ALERT_40';
const OPEN_AGING_STATUSES = new Set(['LIVE', 'ON_HOLD', 'APPROVED']);
/** Days since the requirement was raised when `raisedOn` is set, otherwise since approval (`liveAt`). */
export function computeRequirementAgingDays(r, now = new Date()) {
    const start = r.raisedOn ?? r.liveAt;
    if (!start)
        return null;
    const end = r.closedAt && r.closedAt.getTime() <= now.getTime() ? r.closedAt : now;
    return Math.max(0, calendarDaysBetween(start, end));
}
export function requirementAgingFlagFromDays(days) {
    if (days == null || days < 0)
        return null;
    if (days < REQUIREMENT_AGING_ORANGE_DAYS)
        return 'green';
    if (days < REQUIREMENT_AGING_RED_DAYS)
        return 'orange';
    return 'red';
}
export function isOpenForAgingAlerts(status) {
    return OPEN_AGING_STATUSES.has(status);
}
export function agingAlertActionForThreshold(threshold) {
    return threshold === 20 ? AGING_ALERT_20_ACTION : AGING_ALERT_40_ACTION;
}
