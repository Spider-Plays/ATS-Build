import { createHash } from 'node:crypto';
/**
 * Stable build id for local diagnostics or an externally supplied CI build.
 * The commit is hashed so the public health check does not reveal it.
 */
export function resolveApiBuildId() {
    const commit = process.env.RENDER_GIT_COMMIT?.trim() ||
        process.env.GIT_COMMIT?.trim() ||
        process.env.COMMIT_SHA?.trim();
    if (!commit)
        return 'dev';
    return createHash('sha256').update(commit).digest('hex').slice(0, 12);
}
