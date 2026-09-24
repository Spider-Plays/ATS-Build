import fs from 'fs';
import path from 'path';
import { parseCtcStringToAnnualInr } from '../ctcNormalize.js';
const MONTHS = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
};
export function parseCsvLine(line) {
    const vals = [];
    let v = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            // Escaped quote inside a quoted field: ""
            if (q && line[i + 1] === '"') {
                v += '"';
                i++;
                continue;
            }
            q = !q;
            continue;
        }
        if (ch === ',' && !q) {
            vals.push(v);
            v = '';
            continue;
        }
        v += ch;
    }
    vals.push(v);
    return vals;
}
function rowFromValues(headers, vals) {
    const row = {};
    headers.forEach((header, i) => {
        const value = (vals[i] ?? '').trim();
        if (!(header in row)) {
            row[header] = value;
            return;
        }
        let n = 2;
        let key = `${header}_dup${n}`;
        while (key in row) {
            n++;
            key = `${header}_dup${n}`;
        }
        row[key] = value;
    });
    return row;
}
/** Split CSV text into records, respecting quoted newlines. */
export function splitCsvRecords(text) {
    const records = [];
    let cur = '';
    let q = false;
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (ch === '"') {
            if (q && normalized[i + 1] === '"') {
                cur += '""';
                i++;
                continue;
            }
            q = !q;
            cur += ch;
            continue;
        }
        if (ch === '\n' && !q) {
            if (cur.trim())
                records.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    if (cur.trim())
        records.push(cur);
    return records;
}
export function parseLegacyCsv(text) {
    const records = splitCsvRecords(text);
    if (records.length < 2)
        return [];
    const headers = parseCsvLine(records[0]).map((h) => h.trim());
    return records.slice(1).map((record) => rowFromValues(headers, parseCsvLine(record)));
}
export function loadLegacyCsvFile(dataDir, fileName) {
    const csvPath = path.join(dataDir, fileName);
    if (!fs.existsSync(csvPath)) {
        throw new Error(`CSV not found: ${csvPath}`);
    }
    let lastError;
    for (let attempt = 1; attempt <= 8; attempt++) {
        try {
            return parseLegacyCsv(fs.readFileSync(csvPath, 'utf8'));
        }
        catch (err) {
            lastError = err;
            const code = err?.code;
            if ((code === 'EBUSY' || code === 'EPERM') && attempt < 8) {
                const waitMs = attempt * 400;
                const end = Date.now() + waitMs;
                while (Date.now() < end) {
                    /* wait for Excel/OneDrive lock to release */
                }
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}
/**
 * Pick the newest matching CSV when SharePoint/Excel exports add suffixes
 * like `Candidate_sheet (10).csv` or `Manpower Requisition Form (MRF) (16).csv`.
 */
export function resolveLatestCsv(dataDir, patterns, fallbackName) {
    if (!fs.existsSync(dataDir)) {
        throw new Error(`Data directory not found: ${dataDir}`);
    }
    const files = fs
        .readdirSync(dataDir)
        .filter((name) => patterns.some((re) => re.test(name)))
        .map((name) => {
        const full = path.join(dataDir, name);
        return { name, mtime: fs.statSync(full).mtimeMs };
    })
        .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0)
        return files[0].name;
    const fallback = path.join(dataDir, fallbackName);
    if (fs.existsSync(fallback))
        return fallbackName;
    throw new Error(`No CSV matching ${patterns.map((p) => p.source).join(' | ')} in ${dataDir}`);
}
export function loadLegacyCsv(dataDir) {
    const fileName = resolveLatestCsv(dataDir, [/^Candidate_sheet(?:\s*\(\d+\))?\.csv$/i], 'Candidate_sheet.csv');
    console.log(`  Candidate CSV: ${fileName}`);
    return loadLegacyCsvFile(dataDir, fileName);
}
export function loadLegacyRequirementCsv(dataDir) {
    const fileName = resolveLatestCsv(dataDir, [
        /^Manpower Requisition Form(?:\s*\(MRF\))?(?:\s*\(\d+\))?\.csv$/i,
        /^Manpower Requisition Form\.csv$/i,
    ], 'Manpower Requisition Form.csv');
    console.log(`  Manpower CSV: ${fileName}`);
    return loadLegacyCsvFile(dataDir, fileName);
}
/** Build a local Date; reject impossible calendar days (e.g. 31-02). */
function makeLocalDate(year, month1to12, day, hours = 0, minutes = 0) {
    if (!Number.isFinite(year) ||
        month1to12 < 1 ||
        month1to12 > 12 ||
        day < 1 ||
        day > 31) {
        return null;
    }
    const date = new Date(year, month1to12 - 1, day, hours, minutes, 0, 0);
    if (Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month1to12 - 1 ||
        date.getDate() !== day) {
        return null;
    }
    return date;
}
/**
 * Candidate sheet / IFT Created / Modified: DD-MM-YYYY (or DD/MM/YYYY), optional HH:mm.
 * Also accepts month names with an explicit year, and ISO YYYY-MM-DD.
 */
export function parseLegacyDate(raw) {
    const s = raw?.trim();
    if (!s || s.toUpperCase() === 'NA')
        return null;
    const dmyTime = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (dmyTime) {
        const [, d, m, y, hh, mm] = dmyTime;
        return makeLocalDate(Number(y), Number(m), Number(d), hh ? Number(hh) : 0, mm ? Number(mm) : 0);
    }
    // "December 6, 2024" / "Dec 6 2024" — year required (never assume current year)
    const monthDay = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})/i);
    if (monthDay) {
        const month = MONTHS[monthDay[1].slice(0, 3).toLowerCase()];
        if (month === undefined)
            return null;
        return makeLocalDate(Number(monthDay[3]), month + 1, Number(monthDay[2]));
    }
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (iso) {
        return makeLocalDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    }
    return null;
}
/** MM-DD-YYYY or M/D/YYYY (IFT Date of Interview US-style export). */
export function parseLegacyDateMdy(raw) {
    const s = raw?.trim();
    if (!s || s.toUpperCase() === 'NA')
        return null;
    const mdyTime = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!mdyTime)
        return null;
    const [, m, d, y, hh, mm] = mdyTime;
    return makeLocalDate(Number(y), Number(m), Number(d), hh ? Number(hh) : 0, mm ? Number(mm) : 0);
}
export function sameCalendarDay(a, b) {
    return (a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate());
}
/**
 * IFT "Date of Interview" is mixed: DD-MM, MM-DD, and M/D/YYYY.
 * Disambiguate using Created (always DD-MM-YYYY) when both readings are possible.
 */
export function parseIftDateOfInterview(doiRaw, createdRaw) {
    const created = parseLegacyDate(createdRaw);
    const doi = doiRaw?.trim();
    if (!doi || doi.toUpperCase() === 'NA')
        return created;
    if (/^[A-Za-z]/.test(doi)) {
        return parseLegacyDate(doi) ?? created;
    }
    const asDmy = parseLegacyDate(doi);
    const asMdy = parseLegacyDateMdy(doi);
    const parts = doi.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (parts) {
        const a = Number(parts[1]);
        const b = Number(parts[2]);
        if (a > 12 && b <= 12)
            return asDmy ?? created;
        if (b > 12 && a <= 12)
            return asMdy ?? created;
    }
    if (created && asDmy && sameCalendarDay(created, asDmy))
        return asDmy;
    if (created && asMdy && sameCalendarDay(created, asMdy))
        return asMdy;
    // Ambiguous numeric DOI that disagrees with Created → trust Created (DD-MM).
    if (created)
        return created;
    // Slash without Created is US-style in this export; dash defaults to DD-MM.
    if (doi.includes('/'))
        return asMdy ?? asDmy;
    return asDmy ?? asMdy;
}
/** Parse free-text CTC to annual INR (name is historical; return value is INR/year). */
export function parseCtcLakhs(raw) {
    const annual = parseCtcStringToAnnualInr(raw);
    return annual > 0 ? annual : null;
}
export function rowGet(row, ...keys) {
    for (const key of keys) {
        const v = row[key]?.trim();
        if (v)
            return v;
    }
    return '';
}
export function normalizeEmail(raw) {
    return raw.trim().toLowerCase();
}
const EXT_BY_MIME_LOOKUP = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.rtf': 'application/rtf',
    '.txt': 'text/plain',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.html': 'text/html',
    '.htm': 'text/html',
};
const RESUME_DIR_NAMES = ['Resume_Repository', 'Resumes', 'resumes', 'resume'];
let resumeIndexCache = null;
let extraResumeSearchDirs = [];
/** Extra absolute folders to walk for `{RESUME ID}.*` (e.g. Downloads\\Resume_Repository (1)). */
export function setResumeSearchDirs(dirs) {
    extraResumeSearchDirs = [
        ...new Set(dirs
            .filter(Boolean)
            .map((d) => path.resolve(d))
            .filter((d) => fs.existsSync(d))),
    ];
    resumeIndexCache = null;
}
export function getResumeSearchDirs() {
    return [...extraResumeSearchDirs];
}
const RESUME_FILE_EXTS = new Set(['.pdf', '.docx', '.doc', '.rtf', '.odt']);
function isResumeFile(filePath) {
    const base = path.basename(filePath);
    if (/_error\.txt$/i.test(base) || /^___?all_errors/i.test(base))
        return false;
    return RESUME_FILE_EXTS.has(path.extname(base).toLowerCase());
}
function walkFiles(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        // SharePoint export dumps failed downloads under __Resume_Repository as *.pdf_Error.txt
        if (ent.isDirectory()) {
            if (/^_+/.test(ent.name))
                continue;
            walkFiles(full, out);
        }
        else if (ent.isFile() && isResumeFile(full)) {
            out.push(full);
        }
    }
    return out;
}
function mimeForPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return EXT_BY_MIME_LOOKUP[ext] || 'application/octet-stream';
}
function toResumeMatch(filePath) {
    return {
        path: filePath,
        mime: mimeForPath(filePath),
        fileName: path.basename(filePath),
    };
}
/** Prefer PDF, then DOCX/DOC, then anything else; shorter names win ties. */
function rankResumePath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const extRank = ext === '.pdf' ? 0 : ext === '.docx' ? 1 : ext === '.doc' ? 2 : ext === '.rtf' ? 3 : 4;
    return extRank * 10_000 + path.basename(filePath).length;
}
function normalizeNameToken(raw) {
    return raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
/** Score how well a file stem matches a candidate name (higher is better). */
function scoreResumeNameMatch(filePath, candidateName) {
    if (!candidateName.trim())
        return 0;
    const stem = path.parse(filePath).name;
    const rest = stem.replace(/^\d+(?:[_\-\s]+|$)/, '');
    const fileTok = normalizeNameToken(rest || stem);
    const nameTok = normalizeNameToken(candidateName);
    if (!fileTok || !nameTok)
        return 0;
    if (fileTok === nameTok)
        return 1000;
    if (fileTok.includes(nameTok) || nameTok.includes(fileTok))
        return 800;
    // Token overlap (split original name on whitespace)
    const nameParts = candidateName
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((p) => p.length >= 2);
    if (nameParts.length === 0)
        return 0;
    let hits = 0;
    for (const part of nameParts) {
        if (fileTok.includes(part))
            hits++;
    }
    return hits * 50;
}
function buildResumeIndex(dataDir) {
    const byExactStem = new Map();
    const byResumeId = new Map();
    const push = (map, key, filePath) => {
        const list = map.get(key);
        if (list) {
            if (!list.includes(filePath))
                list.push(filePath);
            return;
        }
        map.set(key, [filePath]);
    };
    const indexDir = (resumeDir) => {
        if (!fs.existsSync(resumeDir))
            return;
        for (const filePath of walkFiles(resumeDir)) {
            const stem = path.parse(filePath).name;
            push(byExactStem, stem.toLowerCase(), filePath);
            const m = stem.match(/^(\d+)/);
            if (m)
                push(byResumeId, m[1], filePath);
        }
    };
    for (const name of RESUME_DIR_NAMES) {
        indexDir(path.join(dataDir, name));
    }
    for (const extra of extraResumeSearchDirs) {
        indexDir(extra);
    }
    return { dataDir, byExactStem, byResumeId };
}
function getResumeIndex(dataDir) {
    const resolved = path.resolve(dataDir);
    if (!resumeIndexCache || resumeIndexCache.dataDir !== resolved) {
        resumeIndexCache = buildResumeIndex(resolved);
    }
    return resumeIndexCache;
}
/** Clear cached resume directory index (tests / after folder updates). */
export function clearResumeIndexCache() {
    resumeIndexCache = null;
}
/**
 * Resolve a local resume file for a SharePoint RESUME ID.
 * Searches `Resume_Repository/` (recursive), `Resumes/`, `resumes/`, `resume/`.
 * Accepts `{id}.pdf` and `{id}_{Name}.pdf` / `{id}-{Name}.*`.
 * When multiple files share an ID, prefers exact stem, then name match, then PDF.
 */
export function findResumeFile(dataDir, resumeId, candidateName) {
    const id = resumeId.trim();
    if (!id)
        return null;
    const index = getResumeIndex(dataDir);
    const exact = index.byExactStem.get(id.toLowerCase()) ?? [];
    if (exact.length === 1)
        return toResumeMatch(exact[0]);
    if (exact.length > 1) {
        const sorted = [...exact].sort((a, b) => rankResumePath(a) - rankResumePath(b));
        return toResumeMatch(sorted[0]);
    }
    const prefixed = index.byResumeId.get(id) ?? [];
    if (prefixed.length === 0)
        return null;
    if (prefixed.length === 1)
        return toResumeMatch(prefixed[0]);
    const scored = [...prefixed].sort((a, b) => {
        const nameDelta = scoreResumeNameMatch(b, candidateName ?? '') - scoreResumeNameMatch(a, candidateName ?? '');
        if (nameDelta !== 0)
            return nameDelta;
        return rankResumePath(a) - rankResumePath(b);
    });
    return toResumeMatch(scored[0]);
}
export function buildImportStats(rows, dataDir) {
    const emails = new Set();
    const titles = new Set();
    const resumeIds = new Set();
    const emailCounts = new Map();
    const statuses = {};
    const subStatuses = {};
    const missingResumeFiles = [];
    for (const row of rows) {
        const email = normalizeEmail(rowGet(row, 'Email ID', 'Email ID1'));
        const title = rowGet(row, 'Title');
        const resumeId = rowGet(row, 'RESUME ID');
        if (email) {
            emails.add(email);
            emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
        }
        if (title)
            titles.add(title);
        if (resumeId) {
            resumeIds.add(resumeId);
            if (resumeId && !findResumeFile(dataDir, resumeId)) {
                missingResumeFiles.push(resumeId);
            }
        }
        const st = rowGet(row, 'Candidate Status') || '(empty)';
        const sub = rowGet(row, 'Candidate Sub Status') || '(empty)';
        statuses[st] = (statuses[st] ?? 0) + 1;
        subStatuses[sub] = (subStatuses[sub] ?? 0) + 1;
    }
    let duplicateEmails = 0;
    for (const count of emailCounts.values()) {
        if (count > 1)
            duplicateEmails++;
    }
    return {
        totalRows: rows.length,
        uniqueTitles: titles.size,
        uniqueEmails: emails.size,
        uniqueResumeIds: resumeIds.size,
        duplicateEmails,
        resumeAttachYes: rows.filter((r) => r['Resume Attach'] === 'Yes').length,
        statuses,
        subStatuses,
        missingResumeFiles: [...new Set(missingResumeFiles)],
    };
}
export function dedupeRowsByEmail(rows, rankFn) {
    const byEmail = new Map();
    for (const row of rows) {
        const email = normalizeEmail(rowGet(row, 'Email ID', 'Email ID1'));
        if (!email)
            continue;
        const list = byEmail.get(email) ?? [];
        list.push(row);
        byEmail.set(email, list);
    }
    const selected = [];
    const skipped = [];
    for (const [email, group] of byEmail) {
        if (group.length === 1) {
            selected.push(group[0]);
            continue;
        }
        const sorted = [...group].sort((a, b) => {
            const rankDiff = rankFn(b) - rankFn(a);
            if (rankDiff !== 0)
                return rankDiff;
            const dateA = parseLegacyDate(rowGet(a, 'Created'))?.getTime() ?? 0;
            const dateB = parseLegacyDate(rowGet(b, 'Created'))?.getTime() ?? 0;
            return dateB - dateA;
        });
        selected.push(sorted[0]);
        for (const row of sorted.slice(1)) {
            skipped.push({
                email,
                title: rowGet(row, 'Title'),
                reason: 'duplicate email — kept row with higher pipeline stage',
            });
        }
    }
    return { selected, skipped };
}
