import multer from 'multer';
import { isAllowedResumeFile } from '../lib/resumeStorage.js';
export const uploadResume = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (isAllowedResumeFile(file.mimetype, file.originalname)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only PDF, DOC, and DOCX files are allowed'));
        }
    },
});
export function handleUploadResume(req, res, next) {
    uploadResume.single('resume')(req, res, (err) => {
        if (!err)
            return next();
        if (err && typeof err === 'object' && 'code' in err && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large (max 5 MB)' });
        }
        return res.status(400).json({
            error: err instanceof Error ? err.message : 'Invalid file upload',
        });
    });
}
