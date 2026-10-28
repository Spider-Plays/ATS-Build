import { prisma } from './prisma.js';
/**
 * Fixed-window hit counters kept in Postgres, so rate limits and sign-in lockouts survive a
 * restart and are shared by every API process instead of living in one process's memory.
 */
let tableReady = null;
function ensureTable() {
    tableReady ??= prisma
        .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RateLimitHit" (
        "key" TEXT NOT NULL,
        "hits" INTEGER NOT NULL,
        "resetAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key")
      )
    `)
        .then(() => undefined)
        .catch((err) => {
        tableReady = null;
        throw err;
    });
    return tableReady;
}
let lastSweep = 0;
/** Drops expired windows now and then so the table stays small. */
async function sweepExpired() {
    const now = Date.now();
    if (now - lastSweep < 10 * 60 * 1000)
        return;
    lastSweep = now;
    await prisma.$executeRaw `DELETE FROM "RateLimitHit" WHERE "resetAt" < NOW()`;
}
/** Adds one hit to `key`, starting a fresh window of `windowMs` once the old one has ended. */
export async function hitCounter(key, windowMs) {
    await ensureTable();
    const resetAt = new Date(Date.now() + windowMs);
    const rows = await prisma.$queryRaw `
    INSERT INTO "RateLimitHit" ("key", "hits", "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "hits" = CASE WHEN "RateLimitHit"."resetAt" <= NOW() THEN 1 ELSE "RateLimitHit"."hits" + 1 END,
      "resetAt" = CASE WHEN "RateLimitHit"."resetAt" <= NOW() THEN EXCLUDED."resetAt" ELSE "RateLimitHit"."resetAt" END
    RETURNING "hits", "resetAt"
  `;
    void sweepExpired().catch(() => undefined);
    return { totalHits: rows[0].hits, resetTime: rows[0].resetAt };
}
/** Current hits in the live window for `key`, or 0 once it has ended. */
export async function readCounter(key) {
    await ensureTable();
    const rows = await prisma.$queryRaw `
    SELECT "hits", "resetAt" FROM "RateLimitHit" WHERE "key" = ${key} AND "resetAt" > NOW()
  `;
    return rows[0] ? { totalHits: rows[0].hits, resetTime: rows[0].resetAt } : undefined;
}
/** Keeps the counter but moves its window end, e.g. to hold a lock for a full period. */
export async function extendCounter(key, untilMs) {
    await ensureTable();
    await prisma.$executeRaw `
    UPDATE "RateLimitHit" SET "resetAt" = ${new Date(Date.now() + untilMs)} WHERE "key" = ${key}
  `;
}
export async function clearCounter(key) {
    await ensureTable();
    await prisma.$executeRaw `DELETE FROM "RateLimitHit" WHERE "key" = ${key}`;
}
/** express-rate-limit store backed by the counters above; `prefix` keeps each limiter apart. */
export class PostgresRateLimitStore {
    prefix;
    localKeys = false;
    windowMs = 60_000;
    constructor(prefix) {
        this.prefix = prefix;
    }
    init(options) {
        this.windowMs = options.windowMs;
    }
    async get(key) {
        return readCounter(this.prefix + key);
    }
    async increment(key) {
        return hitCounter(this.prefix + key, this.windowMs);
    }
    async decrement(key) {
        await ensureTable();
        await prisma.$executeRaw `
      UPDATE "RateLimitHit" SET "hits" = GREATEST("hits" - 1, 0) WHERE "key" = ${this.prefix + key}
    `;
    }
    async resetKey(key) {
        await clearCounter(this.prefix + key);
    }
}
