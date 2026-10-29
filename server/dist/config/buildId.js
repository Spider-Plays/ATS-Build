import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
let cached;
/** The deployed commit: CI-supplied env first, else the git checkout the server runs from. */
function resolveCommit() {
    const fromEnv = process.env.RENDER_GIT_COMMIT?.trim() ||
        process.env.GIT_COMMIT?.trim() ||
        process.env.COMMIT_SHA?.trim();
    if (fromEnv)
        return fromEnv;
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    }
    catch {
        return '';
    }
}
/**
 * Stable build id stamped from the deployed commit, resolved once per process.
 * The commit is hashed so the public health check does not reveal it.
 */
export function resolveApiBuildId() {
    if (cached !== undefined)
        return cached;
    const commit = resolveCommit();
    cached = commit ? createHash('sha256').update(commit).digest('hex').slice(0, 12) : 'dev';
    return cached;
}
