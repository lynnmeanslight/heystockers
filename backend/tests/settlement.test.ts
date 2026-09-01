import { afterEach, describe, expect, it, vi } from 'vitest'
import { TRADE_ASSETS } from '../src/assets'
import { settleOpenCalls } from '../src/settlement'

type BoundStatement = { sql: string; values: unknown[] }

function stubDb(openCalls: object[]) {
  const batched: BoundStatement[][] = []
  const db = {
    prepare(sql: string) {
      return {
        bind: (...values: unknown[]) => ({ sql, values }),
        all: async () => ({ results: openCalls }),
      }
    },
    batch: async (statements: BoundStatement[]) => {
      batched.push(statements)
      return []
    },
  } as unknown as D1Database
  return { db, batched }
}

describe('cron settlement', () => {
  afterEach(() => vi.restoreAllMocks())

  it('settles hit targets and passed deadlines, leaving unpriced calls open', async () => {
    const asset = TRADE_ASSETS[0]
    const now = Date.parse('2026-09-01T12:00:00.000Z')
    const future = '2026-09-10T00:00:00.000Z'
    const past = '2026-08-30T00:00:00.000Z'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify([
      { pairAddress: 'pool', baseToken: { address: asset.mint }, priceUsd: '120', volume: { h24: 10 }, liquidity: { usd: 100 } },
    ]), { headers: { 'Content-Type': 'application/json' } }))

    const { db, batched } = stubDb([
      { id: 'won', symbol: asset.symbol, side: 'BUY', targetPrice: 110, deadline: future },
      { id: 'open', symbol: asset.symbol, side: 'BUY', targetPrice: 130, deadline: future },
      { id: 'lost', symbol: asset.symbol, side: 'BUY', targetPrice: 130, deadline: past },
      { id: 'no-price', symbol: 'UNLISTEDx', side: 'BUY', targetPrice: 1, deadline: past },
    ])

    const settled = await settleOpenCalls(db, now)

    expect(settled).toBe(2)
    const updates = batched[0]
    expect(updates).toHaveLength(2)
    expect(updates[0].values).toEqual(['WON', new Date(now).toISOString(), 120, 'won'])
    expect(updates[1].values).toEqual(['LOST', new Date(now).toISOString(), 120, 'lost'])
  })
})
