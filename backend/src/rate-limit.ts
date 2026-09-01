type Bucket = { count: number; resetsAt: number }
const buckets = new Map<string, Bucket>()

export function takeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const current = buckets.get(key)
  if (!current || current.resetsAt <= now) {
    buckets.set(key, { count: 1, resetsAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, retryAfter: 0 }
  }
  if (current.count >= limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((current.resetsAt - now) / 1000)) }
  }
  current.count += 1
  return { allowed: true, remaining: limit - current.count, retryAfter: 0 }
}

// D1-backed fixed window shared across all Worker isolates and PoPs, so limits
// on sensitive routes cannot be reset by isolate churn. Falls back to the
// in-memory limiter if the database write fails.
export async function takeDurableRateLimit(db: D1Database, key: string, limit: number, windowMs: number, now = Date.now()) {
  try {
    const row = await db.prepare(
      `INSERT INTO rate_limits (key, count, resets_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN resets_at <= ?3 THEN 1 ELSE count + 1 END,
         resets_at = CASE WHEN resets_at <= ?3 THEN ?2 ELSE resets_at END
       RETURNING count, resets_at AS resetsAt`,
    ).bind(key, now + windowMs, now).first<{ count: number; resetsAt: number }>()
    if (!row) return takeRateLimit(key, limit, windowMs, now)
    if (row.count > limit) {
      return { allowed: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((row.resetsAt - now) / 1000)) }
    }
    return { allowed: true, remaining: limit - row.count, retryAfter: 0 }
  } catch {
    return takeRateLimit(key, limit, windowMs, now)
  }
}

export function clearRateLimits() {
  buckets.clear()
}
