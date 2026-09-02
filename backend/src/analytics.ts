import { getStockMarket } from './market'

const SNAPSHOT_EVERY_MINUTES = 5
const HISTORY_WINDOW_MS = 24 * 60 * 60_000

export type LeaderRow = {
  wallet: string
  username: string | null
  wins: number
  losses: number
  openCalls: number
  winRate: number
  stakedPnlUsdc: number
  lastCallAt: string
}

// Settled accuracy ranking: most hits first, ties broken by win rate then
// staked P&L. Staked P&L moves each call's USDC commitment by the price change
// from entry to the settlement price.
export async function getLeaderboard(db: D1Database, limit = 25) {
  const result = await db.prepare(
    `SELECT c.wallet, p.username,
       SUM(c.outcome = 'WON') AS wins,
       SUM(c.outcome = 'LOST') AS losses,
       SUM(c.outcome = 'OPEN') AS openCalls,
       CAST(SUM(c.outcome = 'WON') AS REAL) / (SUM(c.outcome = 'WON') + SUM(c.outcome = 'LOST')) AS winRate,
       ROUND(SUM(CASE WHEN c.outcome != 'OPEN' AND c.resolved_price IS NOT NULL AND c.entry_price > 0
         THEN c.commitment_usdc * (CASE WHEN c.side = 'BUY'
           THEN c.resolved_price / c.entry_price - 1
           ELSE (c.entry_price - c.resolved_price) / c.entry_price END)
         ELSE 0 END), 2) AS stakedPnlUsdc,
       MAX(c.created_at) AS lastCallAt
     FROM position_calls c
     LEFT JOIN profiles p ON p.wallet = c.wallet
     GROUP BY c.wallet
     HAVING wins + losses > 0
     ORDER BY wins DESC, winRate DESC, stakedPnlUsdc DESC
     LIMIT ?`,
  ).bind(Math.min(100, Math.max(1, limit))).all<LeaderRow>()
  return result.results
}

// The cron fires every minute; floor each run into a 5-minute bucket so the
// first run per bucket inserts and the rest no-op via INSERT OR IGNORE. Never
// gate on the wall-clock minute: Cloudflare can start the run seconds after
// scheduledTime, rolling Date.now() past the mark.
export async function capturePriceSnapshots(db: D1Database, now = Date.now()) {
  const bucketMs = SNAPSHOT_EVERY_MINUTES * 60_000
  const capturedAt = new Date(Math.floor(now / bucketMs) * bucketMs).toISOString()
  const prices = (await getStockMarket()).prices
  const entries = Object.entries(prices).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
  if (!entries.length) return 0
  await db.batch([
    ...entries.map(([symbol, price]) => db.prepare(
      'INSERT OR IGNORE INTO price_snapshots (symbol, price, captured_at) VALUES (?, ?, ?)',
    ).bind(symbol, price, capturedAt)),
    db.prepare('DELETE FROM price_snapshots WHERE captured_at < ?').bind(new Date(now - HISTORY_WINDOW_MS).toISOString()),
  ])
  return entries.length
}

// Hourly averages over the last 24h, oldest first: at most 24 points per symbol.
export async function getPriceHistory(db: D1Database, now = Date.now()) {
  const since = new Date(now - HISTORY_WINDOW_MS).toISOString()
  const result = await db.prepare(
    `SELECT symbol, AVG(price) AS price, strftime('%Y-%m-%dT%H:00:00Z', captured_at) AS bucket
     FROM price_snapshots WHERE captured_at >= ?
     GROUP BY symbol, bucket ORDER BY bucket ASC`,
  ).bind(since).all<{ symbol: string; price: number; bucket: string }>()
  const series: Record<string, number[]> = {}
  for (const row of result.results) (series[row.symbol] ??= []).push(row.price)
  return series
}
