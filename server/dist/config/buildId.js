/** Stable per-deploy id — Render sets RENDER_GIT_COMMIT on each build. */
export function resolveApiBuildId() {
    return (process.env.RENDER_GIT_COMMIT?.trim() ||
        process.env.GIT_COMMIT?.trim() ||
        process.env.COMMIT_SHA?.trim() ||
        'dev');
}
