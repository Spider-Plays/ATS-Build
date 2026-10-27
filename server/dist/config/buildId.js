/** Stable build id for local diagnostics or an externally supplied CI build. */
export function resolveApiBuildId() {
    return (process.env.RENDER_GIT_COMMIT?.trim() ||
        process.env.GIT_COMMIT?.trim() ||
        process.env.COMMIT_SHA?.trim() ||
        'dev');
}
