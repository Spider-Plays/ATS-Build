/** Retry transient PostgreSQL connection failures. */
export async function withDbRetry(fn, options = {}) {
    const attempts = options.attempts ?? 6;
    const delayMs = options.delayMs ?? 5000;
    const label = options.label ?? 'database';
    let lastError;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            const msg = err instanceof Error ? err.message : String(err);
            const retryable = msg.includes("Can't reach database server") ||
                msg.includes('P1001') ||
                msg.includes('connection');
            if (!retryable || i === attempts)
                break;
            console.warn(`${label}: not reachable (attempt ${i}/${attempts}). Retrying in ${delayMs / 1000}s…`);
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
    throw lastError;
}
