import { beforeEach, describe, expect, it } from 'vitest'
import { targetMatchesSide } from '../src/position-calls'
import { clearRateLimits, takeRateLimit } from '../src/rate-limit'
import { allowedOrigin } from '../src/security'
import { matchesPositionTrade } from '../src/solana'
import { TRADE_ASSETS } from '../src/assets'
import { summarizeMarkets } from '../src/market'

describe('stock catalog', () => {
  it('ships no more than 50 unique volume-ranked Solana equities', () => {
    expect(TRADE_ASSETS.length).toBeGreaterThanOrEqual(10)
    expect(TRADE_ASSETS.length).toBeLessThanOrEqual(50)
    expect(new Set(TRADE_ASSETS.map((asset) => asset.mint)).size).toBe(TRADE_ASSETS.length)
    expect(TRADE_ASSETS.every((asset, index) => index === 0 || TRADE_ASSETS[index - 1].volume24h >= asset.volume24h)).toBe(true)
  })

  it('deduplicates pools while selecting the most liquid live price', () => {
    const asset = TRADE_ASSETS[0]
    const pair = { pairAddress: 'pool-a', baseToken: { address: asset.mint }, priceUsd: '12.5', volume: { h24: 100 }, liquidity: { usd: 500 } }
    const market = summarizeMarkets([[pair, pair]])
    expect(market.prices[asset.symbol]).toBe(12.5)
    expect(market.volumes[asset.symbol]).toBe(100)
  })
})

describe('position calls', () => {
  it('requires targets to match the declared direction', () => {
    expect(targetMatchesSide('BUY', 100, 110)).toBe(true)
    expect(targetMatchesSide('BUY', 100, 90)).toBe(false)
    expect(targetMatchesSide('SELL', 100, 90)).toBe(true)
    expect(targetMatchesSide('SELL', 100, 110)).toBe(false)
  })

  it('requires proof to match the wallet, side, asset, and commitment', () => {
    const wallet = '8dZZqYCJdyk9XJG3WaaphpLRgzoC9bEMu3nncmEKMcf1'
    const assetMint = 'stock-mint'
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const balance = (owner: string, mint: string, amount: string) => ({ owner, mint, uiTokenAmount: { amount } })
    const transaction = {
      meta: {
        preTokenBalances: [balance(wallet, usdcMint, '20000000'), balance(wallet, assetMint, '0')],
        postTokenBalances: [balance(wallet, usdcMint, '10000000'), balance(wallet, assetMint, '1000000')],
      },
    }
    expect(matchesPositionTrade(transaction, wallet, { assetMint, side: 'BUY', commitmentUsdc: 10 })).toBe(true)
    expect(matchesPositionTrade(transaction, wallet, { assetMint, side: 'SELL', commitmentUsdc: 10 })).toBe(false)
    expect(matchesPositionTrade(transaction, wallet, { assetMint, side: 'BUY', commitmentUsdc: 20 })).toBe(false)
  })
})

describe('request safety', () => {
  beforeEach(clearRateLimits)

  it('allows only configured browser origins while allowing native requests without Origin', () => {
    expect(allowedOrigin(undefined, 'https://heystockers.example')).toBe(true)
    expect(allowedOrigin('https://heystockers.example', 'https://heystockers.example')).toBe(true)
    expect(allowedOrigin('https://evil.example', 'https://heystockers.example')).toBe(false)
  })

  it('limits repeated requests in a window', () => {
    expect(takeRateLimit('wallet', 2, 60_000, 1).allowed).toBe(true)
    expect(takeRateLimit('wallet', 2, 60_000, 2).allowed).toBe(true)
    expect(takeRateLimit('wallet', 2, 60_000, 3).allowed).toBe(false)
    expect(takeRateLimit('wallet', 2, 60_000, 60_002).allowed).toBe(true)
  })
})
