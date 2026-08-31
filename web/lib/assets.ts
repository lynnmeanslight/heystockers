import { GENERATED_TRADE_ASSETS } from './catalog.generated.ts';
import { brandLogoUrl } from './brand-logos.ts';

export type TradeAsset = {
  symbol: string;
  shortName: string;
  name: string;
  logo: string;
  type: 'STOCK' | 'ETF';
  mint: string;
  decimals: number;
  referencePrice: number;
  volume24h: number;
};

export const USDC = {
  symbol: 'USDC',
  name: 'USD Coin',
  type: 'CRYPTO' as const,
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6,
  referencePrice: 1,
};

export const TRADE_ASSETS: TradeAsset[] = GENERATED_TRADE_ASSETS.map((asset) => ({
  ...asset,
  logo: brandLogoUrl(asset.symbol, asset.logo),
}));

export function toAtomicAmount(asset: TradeAsset, side: 'buy' | 'sell', dollars: number, livePriceUsd = asset.referencePrice) {
  if (side === 'buy') return Math.floor(dollars * 10 ** USDC.decimals).toString();
  const assetUnits = dollars / livePriceUsd;
  return Math.floor(assetUnits * 10 ** asset.decimals).toString();
}

export function formatAtomicAmount(value: string, decimals: number, maximumFractionDigits = 6) {
  const amount = Number(value) / 10 ** decimals;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(amount);
}
