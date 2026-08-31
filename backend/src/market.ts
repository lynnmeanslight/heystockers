import { TRADE_ASSETS, USDC } from './assets'
import type { Bindings } from './types'

type MarketSnapshot = { prices: Record<string, number | null>; volumes: Record<string, number>; expiresAt: number }
type DexPair = { pairAddress?: string; baseToken?: { address?: string }; priceUsd?: string | null; volume?: { h24?: number }; liquidity?: { usd?: number } | null }

let marketCache: MarketSnapshot | null = null
let marketInFlight: Promise<MarketSnapshot> | null = null

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))
}

function tradeBaseUrl(env: Bindings) {
  return env.DFLOW_TRADE_API_URL ?? 'https://dev-quote-api.dflow.net'
}

function tradeHeaders(env: Bindings) {
  const headers = new Headers({ Accept: 'application/json' })
  if (env.DFLOW_API_KEY) headers.set('x-api-key', env.DFLOW_API_KEY)
  return headers
}

export function summarizeMarkets(pairGroups: DexPair[][]) {
  const markets = new Map(TRADE_ASSETS.map((asset) => [asset.mint, { price: null as number | null, volume: 0, liquidity: -1, pairs: new Set<string>() }]))
  for (const pairs of pairGroups) for (const pair of pairs) {
    const mint = pair.baseToken?.address
    const market = mint ? markets.get(mint) : undefined
    const pairId = pair.pairAddress ?? ''
    if (!market || market.pairs.has(pairId)) continue
    market.pairs.add(pairId)
    market.volume += Number(pair.volume?.h24) || 0
    const liquidity = Number(pair.liquidity?.usd) || 0
    const price = Number(pair.priceUsd)
    if (price > 0 && liquidity > market.liquidity) {
      market.price = price
      market.liquidity = liquidity
    }
  }
  return {
    prices: Object.fromEntries(TRADE_ASSETS.map((asset) => [asset.symbol, markets.get(asset.mint)?.price ?? null])) as Record<string, number | null>,
    volumes: Object.fromEntries(TRADE_ASSETS.map((asset) => [asset.symbol, markets.get(asset.mint)?.volume ?? 0])) as Record<string, number>,
  }
}

export async function getStockMarket() {
  if (marketCache && marketCache.expiresAt > Date.now()) return marketCache
  if (marketInFlight) return marketInFlight
  marketInFlight = (async () => {
    try {
      const pairGroups = await Promise.all(chunks(TRADE_ASSETS, 30).map(async (assets) => {
        const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${assets.map((asset) => asset.mint).join(',')}`, { headers: { Accept: 'application/json' } })
        if (!response.ok) throw new Error('Solana market data rejected')
        return response.json<DexPair[]>()
      }))
      const market = summarizeMarkets(pairGroups)
      marketCache = { ...market, expiresAt: Date.now() + 60_000 }
    } catch {
      marketCache = {
        prices: Object.fromEntries(TRADE_ASSETS.map((asset) => [asset.symbol, null])),
        volumes: Object.fromEntries(TRADE_ASSETS.map((asset) => [asset.symbol, asset.volume24h])),
        expiresAt: Date.now() + 15_000,
      }
    } finally {
      marketInFlight = null
    }
    return marketCache
  })()
  return marketInFlight
}

export async function getStockPrices(_env?: Bindings) {
  return (await getStockMarket()).prices
}

export async function buildOrder(env: Bindings, input: { inputMint: string; outputMint: string; amount: string; userPublicKey?: string }) {
  const allowed = new Set([USDC.mint, ...TRADE_ASSETS.map((asset) => asset.mint)])
  if (!allowed.has(input.inputMint) || !allowed.has(input.outputMint) || input.inputMint === input.outputMint) {
    throw new Response(JSON.stringify({ error: 'Unsupported trading pair.' }), { status: 400 })
  }
  if (!/^\d+$/.test(input.amount) || input.amount === '0') {
    throw new Response(JSON.stringify({ error: 'Amount must be a positive atomic integer.' }), { status: 400 })
  }
  const params = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
    slippageBps: 'auto',
    prioritizationFeeLamports: 'auto',
  })
  if (input.userPublicKey) params.set('userPublicKey', input.userPublicKey)
  return fetch(`${tradeBaseUrl(env)}/order?${params}`, { headers: tradeHeaders(env) })
}
