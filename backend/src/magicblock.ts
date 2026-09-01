import { TRADE_ASSETS, USDC } from './assets'

const DEFAULT_API_URL = 'https://payments.magicblock.app'
const REPRESENTATIVE_USDC_ATOMIC = '1000000'

export type MagicBlockCompatibilityResult = {
  symbol: string
  side: 'BUY' | 'SELL'
  inputMint: string
  outputMint: string
  amount: string
  compatible: boolean
  outAmount: string | null
  priceImpactPct: string | null
  latencyMs: number
  error: string | null
}

type QuoteResponse = {
  inputMint?: unknown
  outputMint?: unknown
  inAmount?: unknown
  outAmount?: unknown
  priceImpactPct?: unknown
  routePlan?: unknown
  error?: unknown
}

function quoteError(payload: QuoteResponse) {
  return typeof payload.error === 'string' && payload.error.trim()
    ? payload.error.slice(0, 200)
    : 'MagicBlock returned an invalid quote.'
}

export async function probeMagicBlockPair(
  asset: (typeof TRADE_ASSETS)[number],
  side: 'BUY' | 'SELL',
  options: { apiUrl?: string; fetcher?: typeof fetch; now?: () => number } = {},
): Promise<MagicBlockCompatibilityResult> {
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? Date.now
  const inputMint = side === 'BUY' ? USDC.mint : asset.mint
  const outputMint = side === 'BUY' ? asset.mint : USDC.mint
  const amount = side === 'BUY'
    ? REPRESENTATIVE_USDC_ATOMIC
    : String(10 ** asset.decimals)
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: '50',
    swapMode: 'ExactIn',
    restrictIntermediateTokens: 'true',
  })
  const startedAt = now()

  try {
    const response = await fetcher(`${options.apiUrl ?? DEFAULT_API_URL}/v1/swap/quote?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    const payload = await response.json() as QuoteResponse
    const valid = response.ok
      && payload.inputMint === inputMint
      && payload.outputMint === outputMint
      && payload.inAmount === amount
      && typeof payload.outAmount === 'string'
      && /^\d+$/.test(payload.outAmount)
      && Number(payload.outAmount) > 0
      && Array.isArray(payload.routePlan)
      && payload.routePlan.length > 0

    return {
      symbol: asset.symbol,
      side,
      inputMint,
      outputMint,
      amount,
      compatible: valid,
      outAmount: valid ? payload.outAmount as string : null,
      priceImpactPct: valid && typeof payload.priceImpactPct === 'string' ? payload.priceImpactPct : null,
      latencyMs: now() - startedAt,
      error: valid ? null : response.ok ? quoteError(payload) : `MagicBlock quote failed with HTTP ${response.status}.`,
    }
  } catch (error) {
    return {
      symbol: asset.symbol,
      side,
      inputMint,
      outputMint,
      amount,
      compatible: false,
      outAmount: null,
      priceImpactPct: null,
      latencyMs: now() - startedAt,
      error: error instanceof Error ? error.message.slice(0, 200) : 'MagicBlock quote failed.',
    }
  }
}

export async function probeMagicBlockCompatibility(options: { apiUrl?: string; fetcher?: typeof fetch } = {}) {
  const pairs = TRADE_ASSETS.flatMap((asset) => (['BUY', 'SELL'] as const).map((side) => ({ asset, side })))
  const results: MagicBlockCompatibilityResult[] = []
  const concurrency = 4
  for (let index = 0; index < pairs.length; index += concurrency) {
    const batch = pairs.slice(index, index + concurrency)
    results.push(...await Promise.all(batch.map(({ asset, side }) => probeMagicBlockPair(asset, side, options))))
  }
  return {
    checkedAt: new Date().toISOString(),
    compatible: results.filter((result) => result.compatible).length,
    total: results.length,
    results,
  }
}

export function summarizeMagicBlockCompatibility(results: MagicBlockCompatibilityResult[]) {
  return TRADE_ASSETS.map((asset) => {
    const buy = results.find((result) => result.symbol === asset.symbol && result.side === 'BUY')
    const sell = results.find((result) => result.symbol === asset.symbol && result.side === 'SELL')
    return {
      symbol: asset.symbol,
      enabled: Boolean(buy?.compatible && sell?.compatible),
      buy: buy?.compatible ?? false,
      sell: sell?.compatible ?? false,
      buyLatencyMs: buy?.latencyMs ?? null,
      sellLatencyMs: sell?.latencyMs ?? null,
      errors: [buy?.error, sell?.error].filter((error): error is string => Boolean(error)),
    }
  })
}