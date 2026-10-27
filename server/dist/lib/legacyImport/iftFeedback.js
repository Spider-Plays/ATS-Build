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
    const rating = tech ? iftToFormRating(tech) : recommendation === 'NO_HIRE' ? 2 : 3;
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
            overallRatingRaw: clean(techRaw),
        },
        summary: clean(rowGet(row, 'L1- Overall Impression and Recommendation-Summary')),
        areas: parseListField(rowGet(row, 'Area of Interview')),
        additionalSkills: parseListField(rowGet(row, 'L1- Additional Skill set - Assessed')),
    };
}
function extractL2(row) {
    if (!hasL2Payload(row))
        return null;
    const techRaw = rowGet(row, 'L2 -Technical Fitment');
    const tech = parseIftRating(techRaw);
    const outcomeRaw = rowGet(row, 'Final Selection-L2 (Managerial)', 'Interview Final Outcome');
    const recommendation = mapIftOutcome(outcomeRaw, 'L2');
    const rating = tech ? iftToFormRating(tech) : recommendation === 'NO_HIRE' ? 2 : 3;
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
            technicalFitmentRaw: clean(techRaw),
        },
        summary: clean(rowGet(row, 'L2- Overall impression and Recommendation-Summary')),
        areas: [],
        additionalSkills: [],
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
/** Competency topics of our Interview Feedback Form (Feedback Form 3.docx) with IFT keywords. */
const COMPETENCY_KEYWORDS = [
    ['Ability to understand technical questions at 1st go?', /understand|grasp|clarif|question|quick learner|concept|fundamental|basics?\b|theory/i],
    ['Problem solving and Critical Thinking?', /problem[- ]solv|logic|critical|think|approach|scenario|analy[sz]|coding|program|puzzle|real[- ]time/i],
    ['Attention to Detail?', /detail|test case|coverage|edge case|negative|boundary|defect|\bbugs?\b|document|report|writing|format|test design/i],
    ['Ability to troubleshoot, debug code & log analysis?', /debug|troubleshoot|\blogs?\b|crash|root cause|\badb\b|charles|proxy|network|console|investigat/i],
    ['Overall communication Skills?', /communicat|articulat|explain|express|confiden|english|fluent|convey|present/i],
    ['Current Project understanding?', /project|domain|current (role|work|company)|requirement|module|product|application|client|worked on|experience in/i],
    ['General Technical Awareness of current industry?', /technical (knowledge|awareness|depth|skills?)|tool|framework|industry|latest|trend|\bai\b|cloud|agile|devops|ci\s*\/?\s*cd|jenkins|\bgit\b/i],
    ['Innovation and Process improvement?', /innovat|improve|process|release|\bbuild\b|optimi|initiative|automat(ed|ing) (the )?(manual|process)|stlc|sdlc/i],
];
/** Tools/skills commonly named in IFT summaries → skill-assessment rows. */
const SKILL_DICTIONARY = [
    ['Manual / Functional Testing', /manual|functional testing|test execution|regression|smoke|sanity/i],
    ['Test Case Design', /test case|test scenario|test design|test plan/i],
    ['Defect Management', /defect|bug (life|report|log)|jira|severity|priority/i],
    ['API Testing', /\bapi\b|postman|rest ?assured|swagger|web ?service/i],
    ['Selenium', /selenium|webdriver/i],
    ['Appium / Mobile', /appium|mobile|android|\bios\b|adb/i],
    ['Java', /\bjava\b(?!script)/i],
    ['Python', /python|pytest/i],
    ['JavaScript / TypeScript', /javascript|typescript|cypress|playwright|webdriverio|\bjs\b/i],
    ['Automation Framework', /framework|\bpom\b|page object|testng|junit|cucumber|bdd|hybrid|data[- ]driven/i],
    ['SQL / Database', /\bsql\b|database|\bdb\b|query|queries/i],
    ['Performance Testing', /performance|jmeter|load ?runner|gatling|load test|stress/i],
    ['Security Testing', /security|owasp|burp|vulnerab|penetration/i],
    ['CI/CD & Version Control', /jenkins|ci\s*\/?\s*cd|pipeline|\bgit\b|github|gitlab/i],
    ['OTT / Streaming Domain', /\bott\b|player|playback|stream|drm|video|subscription/i],
    ['Log Analysis & Debugging', /\blogs?\b|debug|crash|charles|proxy|console/i],
    ['Coding / Programming', /coding|program(ming)?|oops|logic(al)? (question|program)/i],
];
/** Graded wording → 1..5 (checked in order; strongest phrases first). */
const SENTIMENT_SCALE = [
    [/\b(excellent|exceptional|outstanding|very (good|strong|well)|in[- ]depth|expert|thorough)\b/i, 5],
    [/\b(no\s+(\w+\s+){0,3}(knowledge|idea|experience|clarity|understanding|exposure)|zero|not at all|very (poor|weak|bad|less)|unable|could ?n.?t (answer|explain)|did ?n.?t know|no hands[- ]on)\b/i, 1],
    [/\b(poor|bad|weak|lack(s|ing|ed)?|not (good|clear|able|aware|confident)|struggl\w*|limited|below|missing|less (knowledge|exposure|experience)|needs? (to|more|improvement)|improve)\b/i, 2],
    [/\b(good|strong|clear|well|confident|solid|sound|hands[- ]on|able to|nice|fluent|impressive|comfortable)\b/i, 4],
    [/\b(average|decent|ok(ay)?|basic|moderate|reasonable|fair|partial|some|satisfactory)\b/i, 3],
];
/** IFT scale 1-Unsatisfactory, 2-Average, 3-Good, 4-Exceptional → form scale 1..5. */
export function iftToFormRating(raw) {
    if (!raw)
        return 0;
    return raw >= 4 ? 5 : raw;
}
function proficiencyForRating(r) {
    if (r <= 0)
        return 'Not Assessed';
    if (r <= 2)
        return 'Beginner';
    if (r === 3)
        return 'Intermediate';
    if (r === 4)
        return 'Advanced';
    return 'Expert';
}
const SENIORITY_PROFICIENCY = {
    JUNIOR: 'Beginner',
    MID: 'Intermediate',
    SENIOR: 'Advanced',
    LEAD: 'Advanced',
    PRINCIPAL: 'Expert',
};
/** Split into clauses so "X is good but Y is weak" rates X and Y separately. */
function splitClauses(text) {
    return text
        .split(/\n+|(?<=[.;!?])\s+|\s*,\s*(?:but|however|though|whereas)\s+|\s+(?:but|however|whereas)\s+|,?\s+and\s+(?=(?:was|is|has|had|also|able|he|she|the candidate)\b)/i)
        .map((s) => s.replace(/^[-•*\s\d.)]+/, '').trim())
        .filter((s) => s.length > 3 && !/^(impression|recommendation|summary)\s*:?$/i.test(s));
}
function clauseSentiment(clause) {
    for (const [re, score] of SENTIMENT_SCALE)
        if (re.test(clause))
            return score;
    return null;
}
/** Rate a topic from its evidence: graded wording wins; neutral mentions lean on the overall rating. */
function rateEvidence(clauses, base) {
    const scores = clauses.map((c) => clauseSentiment(c) ?? base).filter((n) => n > 0);
    if (!scores.length)
        return 0;
    return Math.max(1, Math.min(5, Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)));
}
function parseListField(raw) {
    const v = clean(raw);
    if (!v || PLACEHOLDER.test(v))
        return [];
    if (v.startsWith('[')) {
        try {
            const arr = JSON.parse(v);
            if (Array.isArray(arr))
                return arr.map((x) => String(x).trim()).filter(Boolean);
        }
        catch {
            /* fall through to delimiter split */
        }
    }
    return v
        .split(/[,\n;]+/)
        .map((x) => x.replace(/^[-•*\s\d.)]+/, '').trim())
        .filter((x) => x.length > 1 && !PLACEHOLDER.test(x) && !/^(no|none)$/i.test(x));
}
function fitmentRating(raw, base) {
    const v = clean(raw).toLowerCase();
    if (!v || PLACEHOLDER.test(v) || /tbd|unsure|need to check|discuss/.test(v))
        return 0;
    const n = parseIftRating(v);
    if (n)
        return iftToFormRating(n);
    if (/^(no|n|not)\b/.test(v))
        return 2;
    if (/partial|average|^ok/.test(v))
        return 3;
    if (/^(yes|y|good|fits?)\b/.test(v))
        return clauseSentiment(v) ?? Math.max(base, 4);
    return clauseSentiment(v) ?? base;
}
function joinRemarks(clauses) {
    return [...new Set(clauses)].join(' ').slice(0, 500);
}
/** Map free-text IFT feedback onto our skill-assessment + competency structure. */
export function mapIftToForm(payload, seniorityLevel) {
    const base = payload.rating;
    const expected = SENIORITY_PROFICIENCY[seniorityLevel ?? ''] ?? 'Intermediate';
    const clauses = splitClauses(payload.summary);
    const skills = [];
    const seen = new Set();
    const addSkill = (name, rating, remarks) => {
        const key = name.toLowerCase();
        if (!name || seen.has(key))
            return;
        seen.add(key);
        skills.push({
            skillAssessed: name.slice(0, 120),
            expectedProficiency: expected,
            possessProficiency: proficiencyForRating(rating),
            rating,
            remarks,
        });
    };
    const evidenceFor = (re) => clauses.filter((c) => re.test(c));
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (payload.round === 'L1') {
        // Tools/skills the interviewer actually wrote about, each with its own evidence.
        for (const [name, re] of SKILL_DICTIONARY) {
            const hits = evidenceFor(re);
            if (hits.length)
                addSkill(name, rateEvidence(hits, base), joinRemarks(hits));
        }
        for (const s of payload.additionalSkills) {
            const hits = evidenceFor(new RegExp(escape(s.split(/\s+/)[0]), 'i'));
            addSkill(s, hits.length ? rateEvidence(hits, base) : base, hits.length ? joinRemarks(hits) : 'Listed as additional skill assessed');
        }
        // Area of interview row carries the interviewer's overall technical rating.
        for (const a of payload.areas) {
            addSkill(`${a} (overall)`, base, payload.extra.overallRatingRaw ? `IFT overall technical rating: ${payload.extra.overallRatingRaw}` : '');
        }
    }
    else {
        const techRaw = payload.extra.technicalFitmentRaw ?? '';
        addSkill('Technical fitment', fitmentRating(techRaw, base), techRaw);
        for (const [label, key] of [
            ['Role / project fitment', 'roleFitment'],
            ['Culture fitment', 'cultureFitment'],
            ['Budget fitment', 'budgetFitment'],
        ]) {
            const raw = payload.extra[key] ?? '';
            addSkill(label, fitmentRating(raw, base), raw);
        }
        for (const [name, re] of SKILL_DICTIONARY) {
            const hits = evidenceFor(re);
            if (hits.length)
                addSkill(name, rateEvidence(hits, base), joinRemarks(hits));
        }
    }
    const competencies = COMPETENCY_KEYWORDS.map(([topic, re]) => {
        const hits = evidenceFor(re);
        if (hits.length)
            return { topic, rating: rateEvidence(hits, base), remarks: joinRemarks(hits) };
        return { topic, rating: 0, remarks: '' };
    });
    // L2 fitment answers inform the matching competencies when the summary is silent.
    if (payload.round === 'L2') {
        const fill = (topicRe, raw, label) => {
            const c = competencies.find((x) => topicRe.test(x.topic));
            const r = fitmentRating(raw, base);
            if (c && !c.rating && r) {
                c.rating = r;
                c.remarks = `${label}: ${clean(raw)}`;
            }
        };
        fill(/project/i, payload.extra.roleFitment ?? '', 'Role / project fitment');
        fill(/industry/i, payload.extra.technicalFitmentRaw ?? '', 'Technical fitment');
    }
    return { skillAssessment: skills, competencies };
}
/** Refine the 3-way IFT outcome into our 5-level recommendation using the rating. */
export function formRecommendation(outcome, rating) {
    if (outcome === 'NO_HIRE')
        return rating === 1 ? 'STRONG_NO_HIRE' : 'NO_HIRE';
    if (outcome === 'HIRE')
        return rating >= 5 ? 'STRONG_HIRE' : 'HIRE';
    return 'ON_HOLD';
}
export function buildIftFormData(payload, form = mapIftToForm(payload)) {
    return JSON.stringify({
        ...form,
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
