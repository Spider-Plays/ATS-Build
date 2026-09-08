import { parseIftDateOfInterview, parseLegacyDate, rowGet } from './parseCsv.js';
const PLACEHOLDER = /^(na|n\/a|nil|null|-|none|n,a)$/i;
function clean(raw) {
    return raw.replace(/\u00a0/g, ' ').replace(/<br\s*\/?>/gi, '\n').trim();
}
function isEmpty(raw) {
    const v = clean(raw);
    return !v || PLACEHOLDER.test(v);
}
export function parseIftRating(raw) {
    const s = clean(raw);
    if (!s)
        return null;
    const m = s.match(/^(\d)\s*[-–]/);
    if (m) {
        const n = Number(m[1]);
        return n >= 1 && n <= 5 ? n : null;
    }
    const word = s.match(/(\d)\s*out\s*of\s*5/i);
    if (word)
        return Number(word[1]);
    return null;
}
export function mapIftOutcome(raw, round) {
    const s = clean(raw).toLowerCase();
    if (!s)
        return round === 'L1' ? 'ON_HOLD' : 'ON_HOLD';
    if (/reject|not\s*select|no\s*hire|decline|drop/.test(s))
        return 'NO_HIRE';
    if (/hold|on\s*hold|await/.test(s))
        return 'ON_HOLD';
    if (/advance|select|proceed|hire|shortlist|yes|ok|suitable/.test(s))
        return 'HIRE';
    return 'ON_HOLD';
}
function rowModified(row) {
    return parseLegacyDate(rowGet(row, 'Modified', 'Created'));
}
function isL2LevelRow(row) {
    const level = rowGet(row, 'Interview Level').toLowerCase();
    return /l2|level-2|managerial/.test(level);
}
function isL1LevelRow(row) {
    const level = rowGet(row, 'Interview Level').toLowerCase();
    return /l1|level-1/.test(level);
}
export function hasL1Payload(row) {
    if (isL2LevelRow(row) && !rowGet(row, 'L1- Overall Technical Rating', 'L1- Overall Impression and Recommendation-Summary')) {
        return false;
    }
    return Boolean(rowGet(row, 'L1- Overall Technical Rating', 'L1- Overall Impression and Recommendation-Summary', 'Interview Final Outcome', 'Name of the Interviewer', 'Date of Interview') && !isL2LevelRow(row)) || Boolean(rowGet(row, 'L1- Overall Technical Rating', 'L1- Overall Impression and Recommendation-Summary')) || (!isL2LevelRow(row) && Boolean(rowGet(row, 'Interview Final Outcome')));
}
export function hasL2Payload(row) {
    return Boolean(rowGet(row, 'L2 -Technical Fitment', 'L2- Overall impression and Recommendation-Summary', 'Final Selection-L2 (Managerial)', 'Name of the Interviewer (L2)')) || isL2LevelRow(row);
}
function buildL1Comments(row) {
    const parts = [];
    const skills = clean(rowGet(row, 'L1- Additional Skill set - Assessed'));
    const summary = clean(rowGet(row, 'L1- Overall Impression and Recommendation-Summary'));
    const rating = clean(rowGet(row, 'L1- Overall Technical Rating'));
    const outcome = clean(rowGet(row, 'Interview Final Outcome'));
    const area = clean(rowGet(row, 'Area of Interview'));
    if (area)
        parts.push(`Area of Interview: ${area}`);
    if (rating)
        parts.push(`Overall Technical Rating: ${rating}`);
    if (skills)
        parts.push(`Additional skills assessed:\n${skills}`);
    if (summary)
        parts.push(`Overall impression:\n${summary}`);
    if (outcome)
        parts.push(`Outcome: ${outcome}`);
    return parts.join('\n\n').trim() || 'Imported from Interview Feedback Tracker (IFT).';
}
function buildL2Comments(row) {
    const parts = [];
    const fields = [
        ['Technical fitment', 'L2 -Technical Fitment'],
        ['Role / project fitment', 'L2- Role/Project Fitment'],
        ['Budget fitment', 'L2 - Budget fitment'],
        ['Culture fitment', 'L2- Culture Fitment'],
        ['Overall impression', 'L2- Overall impression and Recommendation-Summary'],
        ['Final selection', 'Final Selection-L2 (Managerial)'],
    ];
    for (const [label, key] of fields) {
        const v = clean(rowGet(row, key));
        if (v)
            parts.push(`${label}: ${v}`);
    }
    return parts.join('\n\n').trim() || 'Imported from Interview Feedback Tracker (IFT) — L2/Managerial.';
}
/** IFT DOI is mixed MDY/DMY; Created is DD-MM — disambiguate in parseIftDateOfInterview. */
function parseIftInterviewDate(row) {
    return parseIftDateOfInterview(rowGet(row, 'Date of Interview'), rowGet(row, 'Created'));
}
function extractL1(row) {
    if (!hasL1Payload(row))
        return null;
    const techRaw = rowGet(row, 'L1- Overall Technical Rating');
    const tech = parseIftRating(techRaw);
    const outcomeRaw = rowGet(row, 'Interview Final Outcome');
    const recommendation = mapIftOutcome(outcomeRaw, 'L1');
    const rating = tech ?? (recommendation === 'NO_HIRE' ? 2 : recommendation === 'ON_HOLD' ? 3 : 4);
    return {
        round: 'L1',
        stageOrder: 0,
        scheduledAt: parseIftInterviewDate(row),
        interviewerName: rowGet(row, 'Name of the Interviewer'),
        technicalRating: tech,
        rating,
        comments: buildL1Comments(row),
        recommendation,
        outcomeRaw,
        modifiedAt: rowModified(row),
        extra: {
            areaOfInterview: clean(rowGet(row, 'Area of Interview')),
            project: clean(rowGet(row, 'Project / Department')),
            reqCode: clean(rowGet(row, 'Requisition ID')),
        },
    };
}
function extractL2(row) {
    if (!hasL2Payload(row))
        return null;
    const techRaw = rowGet(row, 'L2 -Technical Fitment');
    const tech = parseIftRating(techRaw);
    const outcomeRaw = rowGet(row, 'Final Selection-L2 (Managerial)', 'Interview Final Outcome');
    const recommendation = mapIftOutcome(outcomeRaw, 'L2');
    const rating = tech ?? (recommendation === 'NO_HIRE' ? 2 : recommendation === 'ON_HOLD' ? 3 : 4);
    return {
        round: 'L2',
        stageOrder: 1,
        scheduledAt: parseIftInterviewDate(row),
        interviewerName: rowGet(row, 'Name of the Interviewer (L2)', 'Name of the Interviewer'),
        technicalRating: tech,
        rating,
        comments: buildL2Comments(row),
        recommendation,
        outcomeRaw,
        modifiedAt: rowModified(row),
        extra: {
            roleFitment: clean(rowGet(row, 'L2- Role/Project Fitment')),
            budgetFitment: clean(rowGet(row, 'L2 - Budget fitment')),
            cultureFitment: clean(rowGet(row, 'L2- Culture Fitment')),
        },
    };
}
function pickNewer(current, next) {
    if (!next)
        return current;
    if (!current)
        return next;
    const curT = current.modifiedAt?.getTime() ?? 0;
    const nextT = next.modifiedAt?.getTime() ?? 0;
    return nextT >= curT ? next : current;
}
/** Group IFT rows by resume + requisition; keep newest L1/L2 payload per group. */
export function groupIftRows(rows) {
    const map = new Map();
    for (const row of rows) {
        const resumeId = rowGet(row, 'Resume ID').trim();
        if (!resumeId)
            continue;
        const reqCode = rowGet(row, 'Requisition ID').trim().toUpperCase();
        const key = `${resumeId}|${reqCode || '_'}`;
        let group = map.get(key);
        if (!group) {
            group = {
                resumeId,
                reqCode,
                candidateName: rowGet(row, 'Title').trim(),
                l1: null,
                l2: null,
            };
            map.set(key, group);
        }
        group.l1 = pickNewer(group.l1, extractL1(row));
        group.l2 = pickNewer(group.l2, extractL2(row));
    }
    return [...map.values()].filter((g) => g.l1 || g.l2);
}
export function buildIftFormData(payload) {
    return JSON.stringify({
        source: 'ift_csv',
        sourceCategory: payload.round === 'L1' ? 'l1' : 'l2_manager',
        iftModified: payload.modifiedAt?.toISOString() ?? null,
        outcomeRaw: payload.outcomeRaw,
        ...payload.extra,
    });
}
export function isPlaceholderPerson(raw) {
    return isEmpty(raw);
}
