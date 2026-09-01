import { getStockMarket } from './market'
import { settlePositionCall, type PositionSide } from './position-calls'

type OpenCall = { id: string; symbol: string; side: PositionSide; targetPrice: number; deadline: string }

// Settlement authority lives here (cron), not in request handlers, so outcomes
// are deterministic instead of depending on when someone loads the feed.
export async function settleOpenCalls(db: D1Database, now = Date.now()) {
  const open = await db.prepare(
    "SELECT id, symbol, side, target_price AS targetPrice, deadline FROM position_calls WHERE outcome = 'OPEN'",
  ).all<OpenCall>()
  if (!open.results.length) return 0
  const prices = (await getStockMarket()).prices
  const resolvedAt = new Date(now).toISOString()
  const updates = []
  for (const call of open.results) {
    const price = prices[call.symbol] ?? null
    if (price === null) continue
    const outcome = settlePositionCall(call.side, call.targetPrice, call.deadline, price, now)
    if (outcome === 'OPEN') continue
    updates.push(db.prepare(
      "UPDATE position_calls SET outcome = ?, resolved_at = ?, resolved_price = ? WHERE id = ? AND outcome = 'OPEN'",
    ).bind(outcome, resolvedAt, price, call.id))
  }
  if (updates.length) await db.batch(updates)
  return updates.length
}

export async function purgeExpiredRows(db: D1Database, now = Date.now()) {
  const iso = new Date(now).toISOString()
  await db.batch([
    db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').bind(iso),
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(iso),
    db.prepare('DELETE FROM rate_limits WHERE resets_at <= ?').bind(now),
  ])
}
