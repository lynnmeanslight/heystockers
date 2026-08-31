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

export function clearRateLimits() {
  buckets.clear()
}
