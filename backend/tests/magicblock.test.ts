import { describe, expect, it, vi } from 'vitest'
import { TRADE_ASSETS, USDC } from '../src/assets'
import { probeMagicBlockPair } from '../src/magicblock'

describe('MagicBlock compatibility probe', () => {
  it('accepts a matching liquid quote and reports sanitized evidence', async () => {
    const asset = TRADE_ASSETS[0]
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      inputMint: USDC.mint,
      outputMint: asset.mint,
      inAmount: '1000000',
      outAmount: '250000',
      priceImpactPct: '0.02',
      routePlan: [{ percent: 100 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    let time = 100

    const result = await probeMagicBlockPair(asset, 'BUY', { fetcher, now: () => time += 25 })

    expect(result).toMatchObject({ symbol: asset.symbol, side: 'BUY', compatible: true, outAmount: '250000', latencyMs: 25, error: null })
    const requestedUrl = new URL(fetcher.mock.calls[0][0] as string)
    expect(requestedUrl.pathname).toBe('/v1/swap/quote')
    expect(Object.fromEntries(requestedUrl.searchParams)).toEqual({
      inputMint: USDC.mint,
      outputMint: asset.mint,
      amount: '1000000',
      slippageBps: '50',
      swapMode: 'ExactIn',
      restrictIntermediateTokens: 'true',
    })
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('fails closed when the upstream quote does not match the requested pair', async () => {
    const asset = TRADE_ASSETS[0]
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      inputMint: asset.mint,
      outputMint: USDC.mint,
      inAmount: '1000000',
      outAmount: '250000',
      routePlan: [{ percent: 100 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await probeMagicBlockPair(asset, 'BUY', { fetcher })

    expect(result.compatible).toBe(false)
    expect(result.outAmount).toBeNull()
    expect(result.error).toBe('MagicBlock returned an invalid quote.')
  })
})