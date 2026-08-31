import { TRADE_ASSETS, USDC } from './assets'
import { getStockPrices } from './market'
import type { PositionSide } from './position-calls'
import type { Bindings } from './types'

type ParsedTokenAccount = { account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } } } }
type ParsedTokenBalance = { mint?: string; owner?: string; uiTokenAmount?: { amount?: string } }
type ParsedTransaction = {
  blockTime?: number | null
  transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string; signer?: boolean }> } }
  meta?: { err?: unknown; preTokenBalances?: ParsedTokenBalance[]; postTokenBalances?: ParsedTokenBalance[] }
}

const legacyTokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const token2022Program = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const assets = [USDC, ...TRADE_ASSETS]
const assetByMint = new Map(assets.map((asset) => [asset.mint, asset]))
const portfolioCache = new Map<string, { value: object; expiresAt: number }>()

async function tokenAccounts(env: Bindings, wallet: string, programId: string) {
  if (!env.SOLANA_TOKEN_RPC_URL) throw new Error('Token-account RPC is not configured')
  const response = await fetch(env.SOLANA_TOKEN_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: programId === legacyTokenProgram ? 'legacy' : 'token-2022', method: 'getTokenAccountsByOwner', params: [wallet, { programId }, { commitment: 'confirmed', encoding: 'jsonParsed' }] }),
  })
  const body = await response.json<{ result?: { value: ParsedTokenAccount[] }; error?: { message?: string } }>()
  if (!response.ok || body.error || !body.result) throw new Error('Token-account RPC failed')
  return body.result.value
}

export async function getPortfolio(env: Bindings, wallet: string) {
  const cached = portfolioCache.get(wallet)
  if (cached && cached.expiresAt > Date.now()) return { payload: cached.value, cache: 'hit' as const }
  const [legacy, token2022, prices] = await Promise.all([
    tokenAccounts(env, wallet, legacyTokenProgram),
    tokenAccounts(env, wallet, token2022Program),
    getStockPrices(env),
  ])
  const balances = new Map<string, { atomic: bigint; decimals: number }>()
  for (const account of [...legacy, ...token2022]) {
    const info = account.account?.data?.parsed?.info
    if (!info?.mint || !assetByMint.has(info.mint)) continue
    const amount = BigInt(info.tokenAmount?.amount ?? '0')
    if (amount <= 0n) continue
    const current = balances.get(info.mint)
    balances.set(info.mint, { atomic: (current?.atomic ?? 0n) + amount, decimals: info.tokenAmount?.decimals ?? assetByMint.get(info.mint)!.decimals })
  }
  const holdings = [...balances].map(([mint, balance]) => {
    const asset = assetByMint.get(mint)!
    const amount = Number(balance.atomic) / 10 ** balance.decimals
    const priceUsd = asset.symbol === 'USDC' ? 1 : prices[asset.symbol] ?? null
    return { symbol: asset.symbol, name: asset.name, amount, priceUsd, valueUsd: priceUsd === null ? null : amount * priceUsd }
  }).sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1))
  const payload = {
    wallet,
    stockValueUsd: holdings.filter((holding) => holding.symbol !== 'USDC').reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0),
    usdcValueUsd: holdings.find((holding) => holding.symbol === 'USDC')?.valueUsd ?? 0,
    holdings,
    prices,
    updatedAt: new Date().toISOString(),
    source: 'Token accounts and Solana market activity',
    rpcCalls: { tokenAccounts: 2 },
  }
  portfolioCache.set(wallet, { value: payload, expiresAt: Date.now() + 30_000 })
  return { payload, cache: 'miss' as const }
}

function atomicBalance(balances: ParsedTokenBalance[], owner: string, mint: string) {
  return balances.filter((balance) => balance.owner === owner && balance.mint === mint)
    .reduce((sum, balance) => sum + BigInt(balance.uiTokenAmount?.amount ?? '0'), 0n)
}

export function matchesPositionTrade(transaction: ParsedTransaction, wallet: string, request: { assetMint: string; side: PositionSide; commitmentUsdc: number }) {
  if (transaction.meta?.err) return false
  const pre = transaction.meta?.preTokenBalances ?? []
  const post = transaction.meta?.postTokenBalances ?? []
  const assetDelta = atomicBalance(post, wallet, request.assetMint) - atomicBalance(pre, wallet, request.assetMint)
  const usdcDelta = atomicBalance(post, wallet, USDC.mint) - atomicBalance(pre, wallet, USDC.mint)
  const minimum = BigInt(Math.floor(request.commitmentUsdc * 1_000_000 * 0.95))
  return request.side === 'BUY'
    ? assetDelta > 0n && usdcDelta < 0n && -usdcDelta >= minimum
    : assetDelta < 0n && usdcDelta > 0n && usdcDelta >= minimum
}

export async function verifyTrade(env: Bindings, signature: string, wallet: string, request: { assetMint: string; side: PositionSide; commitmentUsdc: number }) {
  if (!env.SOLANA_PROOF_RPC_URL) throw new Error('Proof RPC is not configured')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(env.SOLANA_PROOF_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'trade-proof', method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
    })
    if (!response.ok) throw new Error('Proof RPC failed')
    const body = await response.json<{ result?: ParsedTransaction | null }>()
    if (!body.result) {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600))
      continue
    }
    const keys = body.result.transaction?.message?.accountKeys ?? []
    const signed = keys.some((key, index) => typeof key === 'string' ? index === 0 && key === wallet : key.pubkey === wallet && key.signer === true)
    return { valid: signed && matchesPositionTrade(body.result, wallet, request), blockTime: body.result.blockTime ?? null }
  }
  return { valid: false, blockTime: null }
}
