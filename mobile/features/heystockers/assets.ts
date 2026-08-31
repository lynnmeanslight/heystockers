import { GENERATED_TRADE_ASSETS } from './catalog.generated'
import { brandLogoUrl } from './brand-logos'

export type TradeAsset = {
  symbol: string
  shortName: string
  name: string
  mint: string
  decimals: number
  logo: string
  referencePrice: number
  volume24h: number
}

export const USDC = {
  symbol: 'USDC',
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
}

export const TRADE_ASSETS: TradeAsset[] = GENERATED_TRADE_ASSETS.map((asset) => ({
  ...asset,
  logo: brandLogoUrl(asset.symbol, asset.logo),
}))

export function getAsset(symbol: string) {
  return TRADE_ASSETS.find((asset) => asset.symbol === symbol) ?? TRADE_ASSETS[0]
}

export function toAtomicAmount(asset: TradeAsset, side: 'buy' | 'sell', dollars: number, livePrice: number) {
  if (side === 'buy') return Math.floor(dollars * 10 ** USDC.decimals).toString()
  return Math.floor((dollars / livePrice) * 10 ** asset.decimals).toString()
}

export function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatVolume(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return '—'
  return `$${value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })} vol`
}

export function shortAddress(value: string) {
  return value ? `${value.slice(0, 4)}…${value.slice(-4)}` : ''
}
