import { parseLegacyDate, rowGet } from './parseCsv.js';
const PIPELINE_RANK = {
    TO_BE_SCREENED: 0,
    SCREEN_SELECT: 1,
    SCREEN_REJECT: 1,
    L1_INTERVIEW: 2,
    L1_INTERVIEW_REJECT: 2,
    MANAGERIAL_INTERVIEW: 3,
    MANAGERIAL_INTERVIEW_REJECT: 3,
    CLIENT_INTERVIEW: 4,
    CLIENT_INTERVIEW_REJECT: 4,
    HR_INTERVIEW: 5,
    HR_INTERVIEW_SELECT: 5,
    HR_INTERVIEW_REJECT: 5,
    TO_BE_OFFERED: 6,
    OFFERED: 7,
    OFFER_ACCEPTED: 8,
    POSITION_ABORT: 6,
    OFFER_DECLINED: 7,
    CANDIDATE_ABORT: 6,
    JOINED: 9,
    BANK: 0,
    ON_HOLD: 0,
};
const REJECT_SUB_STATUSES = /reject|dropped|declined|not\s*selected|no\s*show|duplicate/i;
/**
 * Map Candidate sheet Status + Sub Status → ATS pipeline status.
 * Trusts sheet labels first (Sub Status preferred for stage).
 * Interview date columns alone do not mean the candidate was selected.
 * DOJ alone must not force JOINED.
 */
export function mapLegacyStatus(row) {
    const status = rowGet(row, 'Candidate Status').trim();
    const sub = rowGet(row, 'Candidate Sub Status').trim();
    const statusL = status.toLowerCase();
    const subL = sub.toLowerCase();
    const combined = `${statusL} ${subL}`.trim();
    if (/^bank$/i.test(status) || /^bank$/i.test(sub))
        return 'BANK';
    if (/req\s*on\s*hold|on\s*hold/i.test(status) || /^on\s*hold$/i.test(sub) || /^hold$/i.test(sub)) {
        return 'ON_HOLD';
    }
    if (/^joined$/i.test(status) || /^joined$/i.test(sub))
        return 'JOINED';
    if (/offer\s*accepted/i.test(sub) || /offer\s*accepted/i.test(status))
        return 'OFFER_ACCEPTED';
    if (/offer\s*declined/i.test(sub) || /offer\s*declined/i.test(status))
        return 'OFFER_DECLINED';
    if (/^offered$/i.test(sub) || /^offered$/i.test(status))
        return 'OFFERED';
    if (/to\s*be\s*offered/i.test(sub) || /to\s*be\s*offered/i.test(status))
        return 'TO_BE_OFFERED';
    if (/could\s*not\s*offer/i.test(combined))
        return 'POSITION_ABORT';
    if (/^offer$/i.test(status))
        return 'OFFERED';
    if (/position\s*abort/i.test(combined))
        return 'POSITION_ABORT';
    if (/candidate\s*abort/i.test(combined) || /^abort$/i.test(status) || /^abort$/i.test(sub)) {
        return 'CANDIDATE_ABORT';
    }
    if (/no\s*show/i.test(combined))
        return 'CANDIDATE_ABORT';
    // Rejects (status or sub) — not selected
    if (REJECT_SUB_STATUSES.test(sub) || /reject|dropped/i.test(status)) {
        if (/hr/i.test(combined))
            return 'HR_INTERVIEW_REJECT';
        if (/client/i.test(combined))
            return 'CLIENT_INTERVIEW_REJECT';
        if (/managerial|l2/i.test(combined))
            return 'MANAGERIAL_INTERVIEW_REJECT';
        if (/l1|technical|interview/i.test(combined))
            return 'L1_INTERVIEW_REJECT';
        return 'SCREEN_REJECT';
    }
    // Explicit selects only when the sheet says Select
    if (/hr\s*interview\s*select|hr\s*select/i.test(subL) || /hr\s*interview\s*select/i.test(statusL)) {
        return 'HR_INTERVIEW_SELECT';
    }
    if (/^screen\s*select$/i.test(subL) || /screen\s*select/i.test(subL))
        return 'SCREEN_SELECT';
    // Sub Status drives in-progress stage (more specific than Candidate Status).
    // "Screening FB Awaited" stays in screening — not L1 — even if Status says Technical Interview.
    if (/screening\s*fb\s*awaited|to\s*be\s*screened|screening\s*fb/i.test(subL)) {
        return 'TO_BE_SCREENED';
    }
    if (/hr\s*(interview|fb|intv)/i.test(subL))
        return 'HR_INTERVIEW';
    if (/client\s*(interview|fb|intv|reject)?/i.test(subL) && /client/i.test(subL)) {
        return 'CLIENT_INTERVIEW';
    }
    if (/managerial\s*(interview|fb|intv)|l2\s*(interview|fb|intv)/i.test(subL)) {
        return 'MANAGERIAL_INTERVIEW';
    }
    if (/^l1\s*(interview|intv|fb)|^l1\b|technical\s*interview/i.test(subL)) {
        return 'L1_INTERVIEW';
    }
    // Candidate Status fallbacks (only when sub did not decide)
    if (/^hr\s*interview$/i.test(statusL) || (/hr/i.test(statusL) && /interview/i.test(statusL))) {
        return 'HR_INTERVIEW';
    }
    if (/^client\s*interview$/i.test(statusL))
        return 'CLIENT_INTERVIEW';
    if (/^managerial\s*interview$/i.test(statusL))
        return 'MANAGERIAL_INTERVIEW';
    if (/^technical\s*interview$/i.test(statusL) || /^interview\s*stage$/i.test(statusL)) {
        return 'L1_INTERVIEW';
    }
    if (/interview/i.test(statusL) || /interview/i.test(subL))
        return 'L1_INTERVIEW';
    if (/screening|sourced|applied|to\s*be\s*screened/i.test(combined)) {
        return 'TO_BE_SCREENED';
    }
    if (rowGet(row, 'Title'))
        return 'TO_BE_SCREENED';
    return 'TO_BE_SCREENED';
}
export function pipelineRank(row) {
    return PIPELINE_RANK[mapLegacyStatus(row)];
}
export function resolveInterviewStageOrder(intLevel) {
    const s = intLevel.toLowerCase();
    if (/hr/.test(s))
        return 2;
    if (/l2|managerial|level-2/.test(s))
        return 1;
    if (/l1|level-1/.test(s))
        return 0;
    return 0;
}
export function extractInterviewSlots(row) {
    const slots = [];
    let l1 = rowGet(row, 'L1 Interview Date');
    let l2 = rowGet(row, 'L2/Managerial Interview Date');
    const scheduled = rowGet(row, 'Scheduled date');
    const startTime = rowGet(row, 'Interview Start Time');
    // SharePoint often copies the L2 day into both L1 and L2 columns.
    // When they match and Scheduled is an earlier day, treat Scheduled as L1
    // (e.g. Bhanu Prakash Pilli: L1/L2=24-07, Scheduled=20-07, IFT L1=20-07).
    const l1Day = l1?.trim().split(/\s+/)[0] ?? '';
    const l2Day = l2?.trim().split(/\s+/)[0] ?? '';
    const schedDay = scheduled?.trim().split(/\s+/)[0] ?? '';
    if (l1Day && l2Day && l1Day === l2Day && schedDay && schedDay !== l1Day) {
        const l1Parsed = parseLegacyDate(l1Day);
        const schedParsed = parseLegacyDate(schedDay);
        if (l1Parsed && schedParsed && schedParsed.getTime() < l1Parsed.getTime()) {
            l1 = scheduled;
        }
    }
    // Prefer timed L2 start when present and on the same calendar day as L2 date.
    if (l2 && startTime) {
        const startDay = startTime.trim().split(/\s+/)[0] ?? '';
        const l2Only = l2.trim().split(/\s+/)[0] ?? '';
        if (startDay && (!l2Only || startDay === l2Only))
            l2 = startTime;
    }
    if (l1) {
        slots.push({
            stageOrder: 0,
            dateRaw: l1,
            panelName: rowGet(row, 'Panel Name'),
            panelEmail: rowGet(row, 'Int panel email'),
            roundStatus: rowGet(row, 'L1 round'),
        });
    }
    if (l2) {
        slots.push({
            stageOrder: 1,
            dateRaw: l2,
            panelName: rowGet(row, 'Panel Name2'),
            panelEmail: rowGet(row, 'Int panel email'),
            roundStatus: rowGet(row, 'L2 round'),
        });
    }
    const hr = rowGet(row, 'HR Interview date');
    if (hr) {
        slots.push({
            stageOrder: 2,
            dateRaw: hr,
            panelName: rowGet(row, 'Interview Panel'),
            panelEmail: rowGet(row, 'Int panel email'),
            roundStatus: rowGet(row, 'HR Round'),
        });
    }
    const intLevel = rowGet(row, 'Int Level');
    if (intLevel && slots.length === 0) {
        const fallback = startTime || scheduled;
        if (fallback) {
            slots.push({
                stageOrder: resolveInterviewStageOrder(intLevel),
                dateRaw: fallback,
                panelName: rowGet(row, 'Interview Panel', 'Panel Name'),
                panelEmail: rowGet(row, 'Int panel email'),
                roundStatus: rowGet(row, 'Interview Schedule'),
            });
        }
    }
    return slots;
}
export function interviewRecordStatus(slot, subStatus, scheduledAt) {
    if (REJECT_SUB_STATUSES.test(subStatus))
        return 'COMPLETED';
    if (/cancel/i.test(slot.roundStatus))
        return 'CANCELLED';
    if (/completed/i.test(slot.roundStatus))
        return 'COMPLETED';
    if (scheduledAt && scheduledAt.getTime() > Date.now())
        return 'SCHEDULED';
    if (scheduledAt)
        return 'COMPLETED';
    return 'COMPLETED';
}
/**
 * Feedback recommendation for an imported interview round.
 * Never defaults to HIRE — L1 Reject etc. must show as Rejected on the interview page.
 */
export function legacyFeedbackRecommendation(row, stageOrder) {
    const mapped = mapLegacyStatus(row);
    const sub = rowGet(row, 'Candidate Sub Status').toLowerCase();
    const status = rowGet(row, 'Candidate Status').toLowerCase();
    const combined = `${status} ${sub}`;
    const outcome = rowGet(row, 'Interview Final outcome', 'HR Int outcome');
    if (/hire|select|proceed/i.test(outcome) && !/not\s*select|reject/i.test(outcome))
        return 'HIRE';
    if (/reject|no\s*hire/i.test(outcome))
        return 'NO_HIRE';
    const rejectStage = mapped === 'L1_INTERVIEW_REJECT' || /l1\s*(interview\s*)?reject/i.test(combined)
        ? 0
        : mapped === 'MANAGERIAL_INTERVIEW_REJECT' || /managerial\s*reject/i.test(combined)
            ? 1
            : mapped === 'CLIENT_INTERVIEW_REJECT' || /client\s*reject/i.test(combined)
                ? 1
                : mapped === 'HR_INTERVIEW_REJECT' || /hr\s*reject/i.test(combined)
                    ? 2
                    : mapped === 'SCREEN_REJECT' ||
                        mapped === 'CANDIDATE_ABORT' ||
                        mapped === 'POSITION_ABORT' ||
                        mapped === 'OFFER_DECLINED' ||
                        /no\s*show|abort|could\s*not\s*offer|duplicate/i.test(combined)
                        ? 0
                        : null;
    if (rejectStage !== null) {
        if (stageOrder < rejectStage)
            return 'HIRE';
        return 'NO_HIRE';
    }
    const currentStage = mapped === 'L1_INTERVIEW'
        ? 0
        : mapped === 'MANAGERIAL_INTERVIEW' || mapped === 'CLIENT_INTERVIEW'
            ? 1
            : mapped === 'HR_INTERVIEW' || mapped === 'HR_INTERVIEW_SELECT'
                ? 2
                : mapped === 'TO_BE_OFFERED' ||
                    mapped === 'OFFERED' ||
                    mapped === 'OFFER_ACCEPTED' ||
                    mapped === 'JOINED' ||
                    mapped === 'SCREEN_SELECT'
                    ? 3
                    : null;
    if (currentStage !== null) {
        if (stageOrder < currentStage)
            return 'HIRE';
        if (stageOrder > currentStage)
            return 'ON_HOLD';
        if (mapped === 'HR_INTERVIEW_SELECT' ||
            mapped === 'JOINED' ||
            mapped === 'OFFER_ACCEPTED' ||
            mapped === 'OFFERED' ||
            mapped === 'TO_BE_OFFERED' ||
            mapped === 'SCREEN_SELECT') {
            return 'HIRE';
        }
        if (/fb\s*awaited|on\s*hold/i.test(sub) || mapped === 'ON_HOLD' || mapped === 'BANK') {
            return 'ON_HOLD';
        }
        // Currently in this round — interviewed but not selected yet
        return 'ON_HOLD';
    }
    if (mapped === 'BANK' || mapped === 'ON_HOLD')
        return 'ON_HOLD';
    return 'ON_HOLD';
}
