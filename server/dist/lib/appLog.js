import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { msUntilNextMidnightIst } from './databaseBackup.js';
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Credentials (incl. the Google sign-in `credential` and MFA `code`) and personal identifiers.
const SENSITIVE_KEY = /pass(word)?|token|secret|otp|apikey|api_key|authorization|cookie|credential|^code$|key$|pan(number)?$|aadhaar|phone|mobile|address|dob|dateofbirth|ctc|salary|bank|ifsc|account(number|no)/i;
const MAX_VALUE_LENGTH = 2000;
export function appLogDir() {
    const configured = process.env.LOGS_DIR?.trim();
    if (!configured)
        return path.join(workspaceRoot, 'logs');
    return path.isAbsolute(configured) ? configured : path.resolve(workspaceRoot, configured);
}
/** YYYY-MM-DD in Asia/Kolkata. */
function istDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}
function logFilePath(day = istDate()) {
    return path.join(appLogDir(), `ats-app-log-${day}.log`);
}
function redact(value, depth = 0) {
    if (value == null || depth > 6)
        return value;
    if (typeof value === 'string') {
        return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…[truncated]` : value;
    }
    if (Array.isArray(value))
        return value.slice(0, 200).map((v) => redact(v, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
        }
        return out;
    }
    return value;
}
const dayCounts = new Map();
/** Appends one JSON line to today's application log file. Never throws. */
export function writeAppLog(event, details = {}) {
    const now = new Date();
    const day = istDate(now);
    const counts = dayCounts.get(day) ?? {};
    counts[event] = (counts[event] ?? 0) + 1;
    dayCounts.set(day, counts);
    const line = JSON.stringify({ time: now.toISOString(), event, ...redact(details) }) + '\n';
    try {
        fs.mkdirSync(appLogDir(), { recursive: true });
        fs.appendFile(logFilePath(day), line, (err) => {
            if (err)
                console.error('[app-log]', err.message);
        });
    }
    catch (error) {
        console.error('[app-log]', error instanceof Error ? error.message : error);
    }
}
function actionFor(method) {
    if (method === 'POST')
        return 'create';
    if (method === 'DELETE')
        return 'delete';
    return 'update';
}
const title = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const looksLikeId = (s) => /\d/.test(s) && s.length >= 2;
/** Which portal the user was in, from the browser page (falls back to the API path). */
function portalFor(page, apiPath) {
    const p = page || '';
    if (p.startsWith('/vendor-portal') || apiPath.startsWith('/api/vendor-portal'))
        return 'Vendor Portal';
    if (p.startsWith('/referral-portal') || apiPath.startsWith('/api/referral-portal'))
        return 'Referral Portal';
    if (p.startsWith('/careers') || apiPath.startsWith('/api/careers'))
        return 'Careers Site';
    if (/^\/(candidate(\/|$)|login$|portal(\/|$)|set-password|signup)/.test(p) || apiPath.startsWith('/api/portal'))
        return 'Candidate Portal';
    if (p.startsWith('/admin'))
        return 'Admin Portal';
    if (p)
        return 'Staff Portal';
    return apiPath.startsWith('/api/interview-rsvp') ? 'Email Link' : 'Unknown';
}
/** Readable page name, e.g. "/candidates/abc123/edit" → "Candidates › Details › Edit". */
function pageLabel(page) {
    const parts = page.split('/').filter(Boolean);
    if (!parts.length)
        return page ? 'Home' : '';
    return parts.map((s) => (looksLikeId(s) ? 'Details' : title(decodeURIComponent(s)))).join(' › ');
}
const RESOURCE_NAMES = {
    candidates: 'candidate', requirements: 'requirement', 'business-requirements': 'business requirement',
    'client-deals': 'client deal', interviews: 'interview', offers: 'offer', users: 'user', vendors: 'vendor',
    'vendor-onboarding': 'vendor onboarding', feedback: 'feedback', skills: 'skill', departments: 'department',
    clients: 'client', cities: 'city', 'dropdown-catalogs': 'dropdown option', 'role-access': 'role access',
    'interview-panels': 'interview panel', 'offer-settings': 'offer settings', 'email-toggles': 'email setting',
    'database-backups': 'database backup', 'activity-logs': 'activity log', portal: 'candidate portal item',
    'vendor-portal': 'vendor portal item', 'referral-portal': 'referral', careers: 'job application',
};
const PORTAL_PREFIXES = new Set(['portal', 'vendor-portal', 'referral-portal', 'careers']);
const ACTION_WORDS = /^(approve|reject|send|resend|cancel|withdraw|accept|decline|submit|restore|archive|assign|advance|move|reschedule|confirm|sign|publish|unpublish|upload|import|export|run|reset|lock|unlock|activate|deactivate|apply|close|reopen|hold|release|rollback|transition|tag|untag)\w*$/;
function shortValue(v) {
    if (v === null || v === undefined || v === '')
        return 'blank';
    if (typeof v === 'object')
        return Array.isArray(v) ? `${v.length} item(s)` : '…';
    const s = String(v);
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
/** One plain-English sentence describing what the request did. */
function describe(method, apiPath, body, status) {
    const segs = apiPath.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const outcome = status >= 400 ? ` — FAILED (${status === 403 ? 'not allowed' : status === 404 ? 'not found' : `error ${status}`})` : '';
    if (segs[0] === 'auth') {
        const what = {
            login: 'Signed in', logout: 'Signed out', refresh: 'Refreshed session', 'session-end': 'Ended session',
            'session-resume': 'Resumed session', 'forgot-password': 'Requested password reset',
            'reset-password': 'Reset password', 'change-password': 'Changed password', signup: 'Signed up',
        };
        const email = typeof b.email === 'string' ? ` as ${b.email}` : '';
        return `${what[segs[1] ?? ''] ?? `Auth: ${title(segs.slice(1).join(' '))}`}${email}${outcome}`;
    }
    // Portal column already names the portal, so describe the record inside it.
    if (PORTAL_PREFIXES.has(segs[0] ?? '') && segs.length > 1)
        segs.shift();
    const resource = RESOURCE_NAMES[segs[0] ?? ''] ?? title(segs[0] ?? 'record').toLowerCase().replace(/s$/, '');
    const id = segs.slice(1).find(looksLikeId);
    const extra = segs.slice(1).filter((s) => !looksLikeId(s)).map((s) => title(s).toLowerCase());
    const name = [b.name, b.title, b.fullName, b.candidateName, b.jobTitle, b.email].find((v) => typeof v === 'string' && v);
    const target = `${resource}${name ? ` "${shortValue(name)}"` : ''}${id ? ` (ID ${id})` : ''}`;
    const changes = Object.entries(b)
        .filter(([k]) => !SENSITIVE_KEY.test(k))
        .slice(0, 6)
        .map(([k, v]) => `${title(k).toLowerCase()} → ${shortValue(v)}`);
    const changeText = changes.length ? `: ${changes.join(', ')}` : '';
    const hidden = Object.keys(b).some((k) => SENSITIVE_KEY.test(k)) ? ' (sensitive fields hidden)' : '';
    let sentence;
    const verb = method === 'POST' ? 'Added' : method === 'DELETE' ? 'Removed' : 'Updated';
    if (extra.length && ACTION_WORDS.test(extra[extra.length - 1]))
        sentence = `${title(extra.join(' '))} — ${target}${changeText}`;
    else if (extra.length)
        sentence = `${verb} ${extra.join(' ')} for ${target}${changeText}`;
    else if (method === 'POST')
        sentence = `Added ${target}`;
    else if (method === 'DELETE')
        sentence = `Deleted ${target}`;
    else
        sentence = `Updated ${target}${changeText}`;
    return `${sentence}${hidden}${outcome}`;
}
/** Logs every create/update/delete request (who, what, result) once the response finishes. */
export function appLogMiddleware(req, res, next) {
    if (!MUTATING_METHODS.has(req.method))
        return next();
    const started = Date.now();
    res.on('finish', () => {
        const apiPath = req.originalUrl.split('?')[0];
        const header = req.get('x-client-page');
        const page = typeof header === 'string' ? header.slice(0, 300) : '';
        writeAppLog(actionFor(req.method), {
            portal: portalFor(page, apiPath),
            page: pageLabel(page),
            activity: describe(req.method, apiPath, req.body, res.statusCode),
            method: req.method,
            path: apiPath,
            query: Object.keys(req.query).length ? req.query : undefined,
            status: res.statusCode,
            success: res.statusCode < 400,
            durationMs: Date.now() - started,
            user: req.auth ? { id: req.auth.userId, email: req.auth.email, role: req.auth.role } : null,
            ip: req.ip,
            body: req.is('application/json') ? req.body : undefined,
        });
    });
    next();
}
/** Legacy monthly workbook (one sheet per day). Only read, to skip days already exported there. */
function monthlyWorkbookPath(day) {
    return path.join(appLogDir(), `ats-app-log-${day.slice(0, 7)}.xlsx`);
}
/** One workbook per day, written by streaming so memory stays flat however large the log is. */
function workbookPath(day) {
    return path.join(appLogDir(), `ats-app-log-${day}.xlsx`);
}
/**
 * Sheet names of an .xlsx, read from xl/workbook.xml inside the zip without loading the workbook
 * (a large monthly workbook loaded through ExcelJS used to exhaust the API's memory).
 */
function xlsxSheetNames(file) {
    const zip = fs.readFileSync(file);
    let eocd = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
        if (zip.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        return [];
    let offset = zip.readUInt32LE(eocd + 16);
    for (let n = zip.readUInt16LE(eocd + 10); n > 0; n--) {
        if (zip.readUInt32LE(offset) !== 0x02014b50)
            return [];
        const method = zip.readUInt16LE(offset + 10);
        const compressedSize = zip.readUInt32LE(offset + 20);
        const nameLength = zip.readUInt16LE(offset + 28);
        const localHeader = zip.readUInt32LE(offset + 42);
        const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
        if (name === 'xl/workbook.xml') {
            const dataStart = localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
            const raw = zip.subarray(dataStart, dataStart + compressedSize);
            const xml = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
            return [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
        }
        offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    }
    return [];
}
const COLUMNS = [
    { header: 'Time (IST)', key: 'time', width: 22 },
    { header: 'User', key: 'user', width: 28 },
    { header: 'Role', key: 'role', width: 16 },
    { header: 'Portal', key: 'portal', width: 16 },
    { header: 'Page', key: 'page', width: 30 },
    { header: 'Activity', key: 'activity', width: 70 },
    { header: 'Action', key: 'action', width: 12 },
    { header: 'Method', key: 'method', width: 9 },
    { header: 'Path', key: 'path', width: 45 },
    { header: 'Status', key: 'status', width: 8 },
    { header: 'Result', key: 'result', width: 10 },
    { header: 'Duration (ms)', key: 'durationMs', width: 13 },
    { header: 'IP', key: 'ip', width: 16 },
    { header: 'Details', key: 'details', width: 80 },
];
function istDateTime(iso) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'short',
        timeStyle: 'medium',
        hour12: false,
    }).format(new Date(iso));
}
function toRow(entry) {
    const { time, event, portal, page, activity, method, path: reqPath, status, success, durationMs, user, ip, ...rest } = entry;
    const u = user;
    const details = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    return {
        time: typeof time === 'string' ? istDateTime(time) : '',
        user: u?.email ?? (method ? 'Anonymous' : 'System'),
        role: u?.role ?? '',
        portal: portal ?? (method ? '' : 'System'),
        page: page ?? '',
        activity: activity ??
            (event === 'server_start' ? 'Application server started' : event === 'day_closed' ? 'End of day summary' : ''),
        action: event,
        method: method ?? '',
        path: reqPath ?? '',
        status: status ?? '',
        result: success === undefined ? '' : success ? 'Success' : 'Failed',
        durationMs: durationMs ?? '',
        ip: ip ?? '',
        details: Object.keys(details).length ? JSON.stringify(details).slice(0, 32000) : '',
    };
}
/**
 * Writes the day's log to its own workbook (sheet named YYYY-MM-DD). Reads the log line by line
 * and streams rows to disk, so memory stays flat for any log size. Skips days already exported,
 * including days that are sheets in the legacy monthly workbook.
 */
export async function exportDayToWorkbook(day) {
    const source = logFilePath(day);
    if (!fs.existsSync(source))
        return false;
    const target = workbookPath(day);
    if (fs.existsSync(target))
        return false;
    const monthly = monthlyWorkbookPath(day);
    if (fs.existsSync(monthly) && xlsxSheetNames(monthly).includes(day))
        return false;
    const tmp = `${target}.tmp`;
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: tmp, useStyles: true });
    const sheet = workbook.addWorksheet(day, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = COLUMNS;
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + COLUMNS.length)}1` };
    sheet.getRow(1).commit();
    const lines = readline.createInterface({ input: fs.createReadStream(source, 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
        if (!line.trim())
            continue;
        try {
            const row = sheet.addRow(toRow(JSON.parse(line)));
            if (row.getCell('result').value === 'Failed')
                row.font = { color: { argb: 'FFC00000' } };
            row.commit();
        }
        catch {
            // skip malformed line
        }
    }
    sheet.commit();
    await workbook.commit();
    fs.renameSync(tmp, target);
    return true;
}
/** Exports finished days (text log only) that are missing from their monthly workbook. */
async function exportPendingDays() {
    const today = istDate();
    const days = fs
        .readdirSync(appLogDir())
        .map((f) => /^ats-app-log-(\d{4}-\d{2}-\d{2})\.log$/.exec(f)?.[1])
        .filter((d) => !!d && d < today)
        .sort();
    for (const day of days) {
        try {
            if (await exportDayToWorkbook(day))
                console.log(`[app-log] Exported ${day} to ${workbookPath(day)}`);
        }
        catch (error) {
            console.error(`[app-log] Excel export ${day}:`, error instanceof Error ? error.message : error);
        }
    }
}
/** At 12 AM IST, seals the finished day's log with a summary and adds it as a sheet to the monthly workbook. */
export function startAppLogRolloverJob() {
    writeAppLog('server_start', { pid: process.pid });
    fs.mkdirSync(appLogDir(), { recursive: true });
    void exportPendingDays();
    const scheduleNext = () => {
        setTimeout(() => {
            const finishedDay = istDate(new Date(Date.now() - 60 * 60 * 1000));
            const summary = { day: finishedDay, counts: dayCounts.get(finishedDay) ?? {} };
            try {
                fs.mkdirSync(appLogDir(), { recursive: true });
                fs.appendFileSync(logFilePath(finishedDay), JSON.stringify({ time: new Date().toISOString(), event: 'day_closed', ...summary }) + '\n');
                console.log(`[app-log] Closed ${logFilePath(finishedDay)}`);
            }
            catch (error) {
                console.error('[app-log]', error instanceof Error ? error.message : error);
            }
            dayCounts.delete(finishedDay);
            void exportPendingDays().finally(scheduleNext);
        }, msUntilNextMidnightIst());
    };
    scheduleNext();
}
