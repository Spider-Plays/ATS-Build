import { Router } from 'express';
import { requireActiveUser, requireAuth } from '../middleware/auth.js';
import { databaseBackupDir, listDatabaseBackups, runDatabaseBackup } from '../lib/databaseBackup.js';
const router = Router();
router.use(requireAuth, requireActiveUser);
function requireDeveloper(req, res, next) {
    if (req.auth?.role !== 'DEVELOPER') {
        res.status(403).json({ error: 'Only Developer can manage database backups' });
        return;
    }
    next();
}
router.get('/', requireDeveloper, (_req, res) => {
    res.json({ directory: databaseBackupDir(), backups: listDatabaseBackups() });
});
/** A full pg_dump is heavy: run one at a time, and space manual runs out so repeated clicks or scripts can't stack them. */
const MANUAL_BACKUP_COOLDOWN_MS = 60_000;
let backupRunning = false;
let lastManualBackupAt = 0;
router.post('/', requireDeveloper, async (_req, res) => {
    if (backupRunning) {
        return res.status(409).json({ error: 'A backup is already running. Try again when it finishes.' });
    }
    const waitMs = lastManualBackupAt + MANUAL_BACKUP_COOLDOWN_MS - Date.now();
    if (waitMs > 0) {
        res.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
        return res.status(429).json({ error: `A backup was just taken. Try again in ${Math.ceil(waitMs / 1000)} seconds.` });
    }
    backupRunning = true;
    lastManualBackupAt = Date.now();
    try {
        const backup = await runDatabaseBackup();
        res.status(201).json({ backup, directory: databaseBackupDir(), backups: listDatabaseBackups() });
    }
    catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Backup failed' });
    }
    finally {
        backupRunning = false;
    }
});
export default router;
