import fs from 'fs/promises';
import os from 'os';
import path from 'path';
export const RESUME_UPLOAD_DIR = process.env.RESUME_UPLOAD_DIR || path.join(os.tmpdir(), 'stitch-ats-resumes');
const ALLOWED_MIME = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const ALLOWED_EXT = new Set(['.pdf', '.doc', '.docx']);
const EXT_BY_MIME = {
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};
const MIME_BY_EXT = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
export function isAllowedResumeFile(mime, filename) {
    const ext = path.extname(filename).toLowerCase();
    if (ALLOWED_EXT.has(ext))
        return true;
    return ALLOWED_MIME.has(mime);
}
export function resolveResumeMime(mime, filename) {
    if (mime && mime !== 'application/octet-stream' && ALLOWED_MIME.has(mime))
        return mime;
    const ext = path.extname(filename).toLowerCase();
    return MIME_BY_EXT[ext] || mime;
}
export function resumeExtension(mime, filename) {
    if (EXT_BY_MIME[mime])
        return EXT_BY_MIME[mime];
    if (filename) {
        const ext = path.extname(filename).toLowerCase();
        if (ALLOWED_EXT.has(ext))
            return ext;
    }
    return '.bin';
}
async function ensureResumeDir() {
    await fs.mkdir(RESUME_UPLOAD_DIR, { recursive: true });
}
function resumeFilePath(candidateId, mime, filename) {
    return path.join(RESUME_UPLOAD_DIR, `${candidateId}${resumeExtension(mime, filename)}`);
}
export async function saveResumeFile(candidateId, mime, buffer, filename, _existingStorageKey) {
    const resolvedMime = resolveResumeMime(mime, filename || '');
    await deleteResumeFile(candidateId);
    await ensureResumeDir();
    const filePath = resumeFilePath(candidateId, resolvedMime, filename);
    await fs.writeFile(filePath, buffer);
    return { mime: resolvedMime, filePath };
}
export async function deleteResumeFile(candidateId, _storageKey) {
    await ensureResumeDir();
    const files = await fs.readdir(RESUME_UPLOAD_DIR).catch(() => []);
    const prefix = `${candidateId}.`;
    await Promise.all(files
        .filter((f) => f.startsWith(prefix))
        .map((f) => fs.unlink(path.join(RESUME_UPLOAD_DIR, f)).catch(() => undefined)));
}
export async function findResumeFile(candidateId, _storageKey) {
    await ensureResumeDir();
    const files = await fs.readdir(RESUME_UPLOAD_DIR).catch(() => []);
    const match = files.find((f) => f.startsWith(`${candidateId}.`));
    if (!match)
        return null;
    const ext = path.extname(match).toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
    return { filePath: path.join(RESUME_UPLOAD_DIR, match), mime };
}
export async function readResumeBuffer(stored) {
    return fs.readFile(stored.filePath);
}
export async function readCandidateResumeFromDisk(candidate) {
    const stored = await findResumeFile(candidate.id, candidate.resumeStorageKey);
    if (!stored)
        return null;
    return { buffer: await readResumeBuffer(stored), mime: stored.mime };
}
export async function readCandidateResumeFromUrl(url, mime) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok)
            return null;
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < 100)
            return null;
        return { buffer, mime: mime || 'application/pdf' };
    }
    catch {
        return null;
    }
}
