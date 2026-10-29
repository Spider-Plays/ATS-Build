import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAllowedResumeFile, resolveResumeMime } from './resumeStorage.js';
import { extractSkillsFromText } from './skills.js';
export async function extractResumeText(buffer, mime, filename) {
    if (!isAllowedResumeFile(mime, filename)) {
        throw new Error('Only PDF, DOC, and DOCX files are allowed');
    }
    const resolved = resolveResumeMime(mime, filename);
    const lower = filename.toLowerCase();
    if (resolved === 'application/pdf' || lower.endsWith('.pdf')) {
        return extractInWorker(buffer, 'pdf');
    }
    if (resolved ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lower.endsWith('.docx')) {
        assertDocxWithinLimits(buffer);
        return extractInWorker(buffer, 'docx');
    }
    throw new Error('Auto-fill works with PDF and DOCX. Save Word files as DOCX or PDF and try again.');
}
/** Parsing an uploaded file may not take longer than this or use more memory than this. */
const PARSE_TIMEOUT_MS = 15_000;
const PARSE_MAX_HEAP_MB = 256;
/** A DOCX is a zip; refuse archives that would expand past this (zip bombs). */
const DOCX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const DOCX_MAX_ENTRIES = 2000;
/**
 * Parses in a short-lived child process so a hostile or pathological file cannot block the
 * API's event loop or exhaust its memory: the child is killed when it runs out of time or heap.
 * (Not a worker thread: pdf-parse loads native modules that crash inside worker threads.)
 */
function extractInWorker(buffer, kind) {
    // Under tsx (development) this module is .ts and the child inherits tsx's loader via execArgv;
    // the compiled build runs the .js file.
    const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
    const child = fork(fileURLToPath(new URL(`./resumeTextWorker${ext}`, import.meta.url)), [], {
        execArgv: [...process.execArgv, `--max-old-space-size=${PARSE_MAX_HEAP_MB}`],
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (child.exitCode === null)
                child.kill();
            fn();
        };
        const timer = setTimeout(() => finish(() => reject(new Error('This file took too long to read. Try saving it again as a simple PDF or DOCX.'))), PARSE_TIMEOUT_MS);
        child.once('message', (msg) => finish(() => (msg.ok ? resolve(msg.text ?? '') : reject(new Error(msg.error || 'Could not read this file')))));
        child.once('error', (err) => finish(() => reject(new Error(`Could not read this file: ${err.message}`))));
        child.once('exit', () => finish(() => reject(new Error('Could not read this file'))));
        child.send({ buffer: new Uint8Array(buffer), kind });
    });
}
/** Reads the zip central directory and rejects archives that are too large once expanded. */
function assertDocxWithinLimits(buffer) {
    const tooLarge = new Error('This DOCX is too large to read. Save it as PDF and try again.');
    // End-of-central-directory record: signature 0x06054b50, within the last 64 KB + 22 bytes.
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new Error('This file is not a valid DOCX document');
    const entries = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    if (entries > DOCX_MAX_ENTRIES)
        throw tooLarge;
    let total = 0;
    for (let n = 0; n < entries; n++) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error('This file is not a valid DOCX document');
        }
        total += buffer.readUInt32LE(offset + 24);
        if (total > DOCX_MAX_UNCOMPRESSED_BYTES)
            throw tooLarge;
        offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    }
}
export function parseResumeFields(text, catalogNames = []) {
    if (!text.trim())
        return {};
    const lines = text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
    const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?){1,2}\d{3,4}[-.\s]?\d{3,4}(?:[-.\s]?\d{2,6})?/);
    const linkedinMatch = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[\w%-]+/i);
    const portfolioMatch = text.match(/https?:\/\/(?!www\.linkedin\.com)[\w.-]+\.[\w]{2,}(?:\/[\w./?#%+=-]*)?/gi);
    const expMatch = text.match(/(\d+(?:\.\d+)?)\s*\+?\s*(years?|yrs?)(?:\s+of\s+experience)?/i);
    const locationMatch = text.match(/(?:^|\n)\s*(?:location|address|city)\s*[:\-]\s*([^\n]{3,60})/im);
    const nameLine = lines.slice(0, 8).find((line) => {
        if (line.length > 55 || /@|https?:\/\/|linkedin/i.test(line))
            return false;
        const words = line.split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 5)
            return false;
        return words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w));
    });
    let firstName;
    let lastName;
    if (nameLine) {
        const words = nameLine.split(/\s+/);
        firstName = words[0];
        lastName = words.slice(1).join(' ');
    }
    // Match on the URL host, not a loose substring: an unanchored /linkedin\.com/
    // would also treat hosts like `linkedin.com.evil.com` as LinkedIn.
    const isLinkedInHost = (u) => {
        try {
            const host = new URL(u.includes('://') ? u : `https://${u}`).hostname.toLowerCase();
            return host === 'linkedin.com' || host.endsWith('.linkedin.com');
        }
        catch {
            return false;
        }
    };
    const portfolio = portfolioMatch?.find((u) => !isLinkedInHost(u)) ?? undefined;
    const extracted = extractSkillsFromText(text, catalogNames);
    const primarySkills = extracted.slice(0, 12);
    const secondarySkills = extracted.slice(12, 24);
    return {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(emailMatch?.[0] && { email: emailMatch[0].toLowerCase() }),
        ...(phoneMatch?.[0] && { phone: phoneMatch[0].replace(/\s+/g, ' ').trim() }),
        ...(linkedinMatch?.[0] && { linkedin: linkedinMatch[0] }),
        ...(portfolio && { portfolio }),
        ...(locationMatch?.[1]?.trim() && { location: locationMatch[1].trim() }),
        ...(expMatch && {
            totalExperience: `${expMatch[1]} Years`,
        }),
        ...(primarySkills.length > 0 && { primarySkills }),
        ...(secondarySkills.length > 0 && { secondarySkills }),
    };
}
export function buildCandidateResumePayload(text, catalogNames = []) {
    const trimmed = text.trim().slice(0, 500_000);
    const extracted = extractSkillsFromText(trimmed, catalogNames);
    return {
        resumeText: trimmed || null,
        primarySkills: JSON.stringify(extracted.slice(0, 15)),
        secondarySkills: JSON.stringify(extracted.slice(15, 30)),
    };
}
