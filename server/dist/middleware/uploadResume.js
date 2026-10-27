import path from 'path';
import multer from 'multer';
import { isAllowedResumeFile } from '../lib/resumeStorage.js';
export const uploadResume = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 50, fieldSize: 100 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (isAllowedResumeFile(file.mimetype, file.originalname)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
        }
    },
});
/** True when the file's leading bytes match its extension (PDF, DOCX zip, or legacy OLE .doc). */
export function hasResumeSignature(buffer, filename) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf')
        return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
    if (ext === '.docx')
        return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    if (ext === '.doc') {
        return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    }
    return false;
}
export function handleUploadResume(req, res, next) {
    uploadResume.single('resume')(req, res, (err) => {
        if (!err) {
            if (req.file && !hasResumeSignature(req.file.buffer, req.file.originalname)) {
                return res.status(400).json({ error: 'The file content does not match a PDF, DOC, or DOCX document' });
            }
            return next();
        }
        if (err && typeof err === 'object' && 'code' in err && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large (max 5 MB)' });
        }
        return res.status(400).json({
            error: err instanceof Error ? err.message : 'Invalid file upload',
        });
    });
}
