/**
 * Decrypt an encrypted database backup (.sql.enc) to plain SQL for restore.
 * Usage: npm run db:decrypt-backup -- <file.sql.enc> [out.sql]
 * Requires DATABASE_BACKUP_KEY in the root .env.
 */
import '../config/loadEnv.js';
import path from 'node:path';
import { databaseBackupDir, decryptBackupFile } from '../lib/databaseBackup.js';
const [input, output] = process.argv.slice(2);
if (!input) {
    console.error('Usage: npm run db:decrypt-backup -- <file.sql.enc> [out.sql]');
    process.exit(1);
}
const inPath = path.isAbsolute(input) ? input : path.join(databaseBackupDir(), input);
const outPath = output ?? inPath.replace(/\.enc$/, '');
decryptBackupFile(inPath, outPath);
console.log(`Decrypted to ${outPath}. Delete it after restoring.`);
