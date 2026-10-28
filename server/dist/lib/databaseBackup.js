import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function databaseBackupDir() {
    const configured = process.env.DATABASE_BACKUP_DIR?.trim();
    if (!configured)
        return path.join(workspaceRoot, 'backups');
    return path.isAbsolute(configured) ? configured : path.resolve(workspaceRoot, configured);
}
function istStamp(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    })
        .formatToParts(now)
        .map((part) => [part.type, part.value]));
    return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}
function istClock(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    })
        .formatToParts(now)
        .map((part) => [part.type, part.value]));
    return {
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
    };
}
/** Milliseconds until the next 00:00:00 Asia/Kolkata. */
export function msUntilNextMidnightIst(now = new Date()) {
    const { hour, minute, second } = istClock(now);
    const waitMs = (((24 - hour) * 60 - minute) * 60 - second) * 1000;
    return waitMs < 1000 ? 24 * 60 * 60 * 1000 : waitMs;
}
function pgDumpCandidates() {
    const fromEnv = process.env.PG_DUMP_PATH?.trim();
    const names = fromEnv ? [fromEnv] : ['pg_dump'];
    if (process.platform === 'win32') {
        const root = 'C:\\Program Files\\PostgreSQL';
        if (fs.existsSync(root)) {
            for (const version of fs.readdirSync(root)) {
                names.push(path.join(root, version, 'bin', 'pg_dump.exe'));
            }
        }
    }
    return names;
}
function parseDatabaseUrl(raw) {
    const url = new URL(raw);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!database)
        throw new Error('DATABASE_URL is missing a database name');
    return {
        host: url.hostname,
        port: url.port || '5432',
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database,
    };
}
export function listDatabaseBackups() {
    const dir = databaseBackupDir();
    if (!fs.existsSync(dir))
        return [];
    return fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.sql') || name.endsWith(BACKUP_ENCRYPTED_EXT))
        .map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export const BACKUP_ENCRYPTED_EXT = '.sql.enc';
const BACKUP_MAGIC = Buffer.from('SATSBAK1');
/** Key from DATABASE_BACKUP_KEY (any passphrase), stretched with scrypt per file. */
export function backupKey(salt) {
    const passphrase = process.env.DATABASE_BACKUP_KEY?.trim();
    if (!passphrase)
        return null;
    return crypto.scryptSync(passphrase, salt, 32);
}
/**
 * Streams a plain dump straight into an AES-256-GCM file, so the clear-text dump never touches disk.
 * File layout: magic(8) | salt(16) | iv(12) | ciphertext | authTag(16).
 */
function encryptStreamToFile(input, encPath) {
    const salt = crypto.randomBytes(16);
    const key = backupKey(salt);
    if (!key) {
        // A full dump holds every candidate's personal data: never write it in clear text.
        return Promise.reject(new Error('DATABASE_BACKUP_KEY is not set; refusing to write an unencrypted backup.'));
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const out = fs.createWriteStream(encPath, { mode: 0o600 });
    out.write(Buffer.concat([BACKUP_MAGIC, salt, iv]));
    return new Promise((resolve, reject) => {
        input.on('error', reject);
        cipher.on('error', reject);
        out.on('error', reject);
        input.pipe(cipher).pipe(out, { end: false });
        cipher.on('end', () => {
            out.end(cipher.getAuthTag(), () => resolve());
        });
    });
}
/** Decrypts a .sql.enc backup produced by encryptStreamToFile. */
export function decryptBackupFile(encPath, outPath) {
    const data = fs.readFileSync(encPath);
    if (!data.subarray(0, 8).equals(BACKUP_MAGIC))
        throw new Error('Not a Stitch ATS encrypted backup');
    const salt = data.subarray(8, 24);
    const iv = data.subarray(24, 36);
    const tag = data.subarray(data.length - 16);
    const key = backupKey(salt);
    if (!key)
        throw new Error('Set DATABASE_BACKUP_KEY to decrypt backups');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data.subarray(36, data.length - 16)), decipher.final()]);
    fs.writeFileSync(outPath, plain, { mode: 0o600 });
}
function restrictFilePermissions(filePath) {
    try {
        fs.chmodSync(filePath, 0o600);
    }
    catch {
        // Windows ignores POSIX modes; restrict the backup folder ACL to the service account instead.
    }
}
/** Deletes backups older than DATABASE_BACKUP_RETENTION_DAYS (default 14). */
function pruneOldBackups() {
    const days = Number(process.env.DATABASE_BACKUP_RETENTION_DAYS) || 14;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const dir = databaseBackupDir();
    for (const backup of listDatabaseBackups()) {
        if (new Date(backup.createdAt).getTime() < cutoff) {
            try {
                fs.unlinkSync(path.join(dir, backup.name));
                console.log(`[backup] Removed expired backup ${backup.name}`);
            }
            catch (error) {
                console.error('[backup] Could not remove', backup.name, error);
            }
        }
    }
}
export async function runDatabaseBackup() {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl)
        throw new Error('DATABASE_URL is not set');
    if (!process.env.DATABASE_BACKUP_KEY?.trim()) {
        throw new Error('DATABASE_BACKUP_KEY is not set; refusing to write an unencrypted backup.');
    }
    const dir = databaseBackupDir();
    fs.mkdirSync(dir, { recursive: true });
    const name = `stitch-ats-${istStamp()}${BACKUP_ENCRYPTED_EXT}`;
    const filePath = path.join(dir, name);
    const db = parseDatabaseUrl(databaseUrl);
    let lastError = 'pg_dump was not found. Install PostgreSQL client tools or set PG_DUMP_PATH.';
    for (const bin of pgDumpCandidates()) {
        try {
            await new Promise((resolve, reject) => {
                // pg_dump writes to stdout, which is encrypted on the way to disk.
                const child = spawn(bin, [
                    '-h',
                    db.host,
                    '-p',
                    db.port,
                    '-U',
                    db.user,
                    '-d',
                    db.database,
                    '--format=plain',
                    '--no-owner',
                    '--no-acl',
                ], {
                    env: { ...process.env, PGPASSWORD: db.password },
                    windowsHide: true,
                });
                let stderr = '';
                child.stderr.on('data', (chunk) => {
                    stderr += String(chunk);
                });
                const written = encryptStreamToFile(child.stdout, filePath);
                const exited = new Promise((done, fail) => {
                    child.on('error', (error) => fail(error));
                    child.on('close', (code) => {
                        if (code === 0)
                            done();
                        else
                            fail(new Error(stderr.trim() || `pg_dump exited with code ${code}`));
                    });
                });
                Promise.all([written, exited]).then(() => resolve(), reject);
            });
            const finalPath = filePath;
            restrictFilePermissions(finalPath);
            pruneOldBackups();
            const finalName = path.basename(finalPath);
            const stat = fs.statSync(finalPath);
            console.log(`[backup] Wrote ${finalName} (${stat.size} bytes)`);
            return { name: finalName, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
        }
        catch (error) {
            if (fs.existsSync(filePath))
                fs.unlinkSync(filePath);
            if (error.code === 'ENOENT')
                continue;
            lastError = error instanceof Error ? error.message : 'Backup failed';
            break;
        }
    }
    throw new Error(lastError);
}
export function startDatabaseBackupJob() {
    const scheduleNext = () => {
        const waitMs = msUntilNextMidnightIst();
        console.log(`[backup] Next full backup at midnight IST (in ${Math.round(waitMs / 60000)} min)`);
        setTimeout(() => {
            void runDatabaseBackup()
                .catch((error) => console.error('[backup]', error instanceof Error ? error.message : error))
                .finally(scheduleNext);
        }, waitMs);
    };
    scheduleNext();
}
