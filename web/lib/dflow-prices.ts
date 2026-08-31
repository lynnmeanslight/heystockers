import { TRADE_ASSETS } from './assets';

type MarketSnapshot = { prices: Record<string, number | null>; volumes: Record<string, number>; expiresAt: number };
type DexPair = { pairAddress?: string; baseToken?: { address?: string }; priceUsd?: string | null; volume?: { h24?: number }; liquidity?: { usd?: number } | null };
let marketCache: MarketSnapshot | null = null;
let marketInFlight: Promise<MarketSnapshot> | null = null;

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

export async function getStockMarket() {
  if (marketCache && marketCache.expiresAt > Date.now()) return marketCache;
  if (marketInFlight) return marketInFlight;
  marketInFlight = (async () => {
    try {
      const markets = new Map(TRADE_ASSETS.map((asset) => [asset.mint, { price: null as number | null, volume: 0, liquidity: -1, pairs: new Set<string>() }]));
      const groups = await Promise.all(chunks(TRADE_ASSETS, 30).map(async (assets) => {
        const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${assets.map((asset) => asset.mint).join(',')}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!response.ok) throw new Error('Solana market data rejected');
        return response.json() as Promise<DexPair[]>;
      }));
      for (const pairs of groups) for (const pair of pairs) {
        const market = pair.baseToken?.address ? markets.get(pair.baseToken.address) : undefined;
        const pairId = pair.pairAddress ?? '';
        if (!market || market.pairs.has(pairId)) continue;
        market.pairs.add(pairId);
        market.volume += Number(pair.volume?.h24) || 0;
        const liquidity = Number(pair.liquidity?.usd) || 0;
        const price = Number(pair.priceUsd);
        if (price > 0 && liquidity > market.liquidity) { market.price = price; market.liquidity = liquidity; }
      }
      marketCache = {
        prices: Object.fromEntries(TRADE_ASSETS.map((asset) => [asset.symbol, markets.get(asset.mint)?.price ?? null])),
        volumes: Object.fromEntries(TRADE_ASSETS.map((asset) => [asset.symbol, markets.get(asset.mint)?.volume ?? 0])),
        expiresAt: Date.now() + 60_000,
      };
    } catch {
      marketCache = {
        prices: Object.fromEntries(TRADE_ASSETS.map((asset) => [asset.symbol, null])),
        volumes: Object.fromEntries(TRADE_ASSETS.map((asset) => [asset.symbol, asset.volume24h])),
        expiresAt: Date.now() + 15_000,
      };
    } finally { marketInFlight = null; }
    return marketCache;
  })();
  return marketInFlight;
}

export async function getStockPrices() {
  return (await getStockMarket()).prices;
}
