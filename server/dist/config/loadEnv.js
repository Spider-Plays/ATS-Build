import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'url';
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const envPath = path.join(workspaceRoot, '.env');
const isProduction = process.env.NODE_ENV === 'production';
function databaseUrlHost(url) {
    if (!url?.trim())
        return null;
    try {
        return new URL(url).hostname;
    }
    catch {
        return null;
    }
}
dotenv.config({ path: envPath, override: !isProduction });
if (!isProduction) {
    const host = databaseUrlHost(process.env.DATABASE_URL);
    console.log(`[env] Single root .env loaded${host ? ` -> ${host}` : ''}`);
}
export function databaseHostLabel() {
    return databaseUrlHost(process.env.DATABASE_URL);
}
