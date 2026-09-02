import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { capturePriceSnapshots, getLeaderboard, getPriceHistory } from '../src/analytics'
import { TRADE_ASSETS } from '../src/assets'

// Minimal D1 facade over node:sqlite so analytics SQL runs against the real schema.
function migratedD1() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  for (const migration of readdirSync(join(process.cwd(), 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    database.exec(readFileSync(join(process.cwd(), 'migrations', migration), 'utf8'))
  }
  const statement = (sql: string, values: unknown[]) => ({
    all: async () => ({ results: database.prepare(sql).all(...(values as [])) }),
    first: async () => database.prepare(sql).get(...(values as [])) ?? null,
    run: async () => ({ meta: { changes: Number(database.prepare(sql).run(...(values as [])).changes) } }),
  })
  const db = {
    prepare: (sql: string) => ({ bind: (...values: unknown[]) => statement(sql, values), ...statement(sql, []) }),
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => Promise.all(statements.map((bound) => bound.run())),
  } as unknown as D1Database
  return { db, database }
}

function seedCall(database: DatabaseSync, call: { id: string; wallet: string; side: 'BUY' | 'SELL'; entry: number; target: number; commitment: number; outcome: 'OPEN' | 'WON' | 'LOST'; resolved: number | null; createdAt: string }) {
  database.prepare(
    `INSERT INTO position_calls (id, wallet, symbol, side, thesis, entry_price, target_price, deadline, commitment_usdc, execution_signature, outcome, resolved_at, resolved_price, created_at)
     VALUES (?, ?, ?, ?, 'A sufficiently detailed thesis.', ?, ?, '2026-12-31T00:00:00.000Z', ?, ?, ?, ?, ?, ?)`,
  ).run(call.id, call.wallet, TRADE_ASSETS[0].symbol, call.side, call.entry, call.target, call.commitment, `sig-${call.id}`,
    call.outcome, call.outcome === 'OPEN' ? null : '2026-09-01T00:00:00.000Z', call.resolved, call.createdAt)
}

describe('leaderboard', () => {
  it('ranks settled accuracy with staked P&L and skips wallets without settled calls', async () => {
    const { db, database } = migratedD1()
    for (const wallet of ['alice', 'bob', 'carol']) {
      database.prepare('INSERT INTO wallets (wallet, joined_at) VALUES (?, ?)').run(wallet, '2026-08-01T00:00:00.000Z')
    }
    database.prepare('INSERT INTO profiles (wallet, username, referral_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('alice', 'alice', 'HSAAAAAAAA', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
    seedCall(database, { id: 'a1', wallet: 'alice', side: 'BUY', entry: 100, target: 110, commitment: 10, outcome: 'WON', resolved: 120, createdAt: '2026-08-02T00:00:00.000Z' })
    seedCall(database, { id: 'a2', wallet: 'alice', side: 'BUY', entry: 100, target: 130, commitment: 10, outcome: 'LOST', resolved: 90, createdAt: '2026-08-03T00:00:00.000Z' })
    seedCall(database, { id: 'a3', wallet: 'alice', side: 'SELL', entry: 100, target: 85, commitment: 5, outcome: 'WON', resolved: 80, createdAt: '2026-08-04T00:00:00.000Z' })
    seedCall(database, { id: 'b1', wallet: 'bob', side: 'BUY', entry: 50, target: 54, commitment: 25, outcome: 'WON', resolved: 55, createdAt: '2026-08-05T00:00:00.000Z' })
    seedCall(database, { id: 'c1', wallet: 'carol', side: 'BUY', entry: 10, target: 12, commitment: 1, outcome: 'OPEN', resolved: null, createdAt: '2026-08-06T00:00:00.000Z' })

    const leaders = await getLeaderboard(db)

    expect(leaders.map((leader) => leader.wallet)).toEqual(['alice', 'bob'])
    expect(leaders[0]).toMatchObject({ username: 'alice', wins: 2, losses: 1, openCalls: 0, stakedPnlUsdc: 2 })
    expect(leaders[0].winRate).toBeCloseTo(2 / 3)
    expect(leaders[1]).toMatchObject({ username: null, wins: 1, losses: 0, stakedPnlUsdc: 2.5, winRate: 1 })
    database.close()
  })
})

describe('price history', () => {
  afterEach(() => vi.restoreAllMocks())

  it('floors runs into five-minute buckets, deduping repeats, and averages per hour', async () => {
    const { db, database } = migratedD1()
    const asset = TRADE_ASSETS[0]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify([
      { pairAddress: 'pool', baseToken: { address: asset.mint }, priceUsd: '120', volume: { h24: 10 }, liquidity: { usd: 100 } },
    ]), { headers: { 'Content-Type': 'application/json' } }))

    // Cron lag lands runs mid-minute; both calls floor into the 10:00 bucket.
    expect(await capturePriceSnapshots(db, Date.parse('2026-09-03T10:01:00.000Z'))).toBeGreaterThan(0)
    expect(await capturePriceSnapshots(db, Date.parse('2026-09-03T10:03:30.000Z'))).toBeGreaterThan(0)
    const bucketRows = database.prepare('SELECT captured_at FROM price_snapshots WHERE symbol = ?').all(asset.symbol) as Array<{ captured_at: string }>
    expect(bucketRows).toEqual([{ captured_at: '2026-09-03T10:00:00.000Z' }])
    expect(await capturePriceSnapshots(db, Date.parse('2026-09-03T10:05:02.000Z'))).toBeGreaterThan(0)

    database.prepare('INSERT INTO price_snapshots (symbol, price, captured_at) VALUES (?, ?, ?)').run(asset.symbol, 100, '2026-09-03T09:10:00.000Z')
    database.prepare('INSERT INTO price_snapshots (symbol, price, captured_at) VALUES (?, ?, ?)').run(asset.symbol, 110, '2026-09-03T09:40:00.000Z')

    const series = await getPriceHistory(db, Date.parse('2026-09-03T10:06:00.000Z'))
    expect(series[asset.symbol]).toEqual([105, 120])
    database.close()
  })

  it('drops snapshots older than the 24h window during capture', async () => {
    const { db, database } = migratedD1()
    const asset = TRADE_ASSETS[0]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify([
      { pairAddress: 'pool', baseToken: { address: asset.mint }, priceUsd: '120', volume: { h24: 10 }, liquidity: { usd: 100 } },
    ]), { headers: { 'Content-Type': 'application/json' } }))
    database.prepare('INSERT INTO price_snapshots (symbol, price, captured_at) VALUES (?, ?, ?)').run(asset.symbol, 90, '2026-09-01T10:00:00.000Z')

    await capturePriceSnapshots(db, Date.parse('2026-09-03T10:05:00.000Z'))

    const remaining = database.prepare('SELECT captured_at FROM price_snapshots ORDER BY captured_at ASC').all() as Array<{ captured_at: string }>
    expect(remaining.every((row) => row.captured_at >= '2026-09-02T10:05:00.000Z')).toBe(true)
    database.close()
  })
})
