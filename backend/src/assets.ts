import { GENERATED_TRADE_ASSETS } from './catalog.generated'

export type TradeAsset = {
  symbol: string
  shortName: string
  name: string
  logo: string
  type: 'STOCK' | 'ETF'
  mint: string
  decimals: number
  referencePrice: number
  volume24h: number
}

export const USDC = {
  symbol: 'USDC',
  name: 'USD Coin',
  type: 'CRYPTO' as const,
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
}

export const TRADE_ASSETS: TradeAsset[] = GENERATED_TRADE_ASSETS.map((asset) => ({ ...asset }))

export const WALLET_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
export const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/
