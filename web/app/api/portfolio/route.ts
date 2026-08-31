import { NextResponse } from 'next/server';
import { TRADE_ASSETS, USDC } from '../../../lib/assets';
import { getStockPrices } from '../../../lib/dflow-prices';

type RpcResponse<T> = { result?: T; error?: { message?: string } };
type ParsedTokenAccount = { account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } } } };

const tokenRpcUrl = process.env.SOLANA_TOKEN_RPC_URL;
const supportedAssets = [USDC, ...TRADE_ASSETS];
const assetByMint = new Map(supportedAssets.map((asset) => [asset.mint, asset]));
const legacyTokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const token2022Program = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const portfolioCache = new Map<string, { payload: object; expiresAt: number }>();

async function getTokenAccounts(wallet: string, programId: string) {
  if (!tokenRpcUrl) throw new Error('SOLANA_TOKEN_RPC_URL is not configured.');
  const response = await fetch(tokenRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: programId === legacyTokenProgram ? 'legacy-tokens' : 'token-2022', method: 'getTokenAccountsByOwner',
      params: [wallet, { programId }, { commitment: 'confirmed', encoding: 'jsonParsed' }],
    }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Token-account RPC rejected the request (${response.status}).`);
  const payload = await response.json() as RpcResponse<{ value: ParsedTokenAccount[] }>;
  if (payload.error || !payload.result) throw new Error(payload.error?.message ?? 'Solana token-account lookup failed.');
  return payload.result.value;
}

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get('wallet') ?? '';
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return NextResponse.json({ error: 'Wallet address is not valid.' }, { status: 400 });
  const cached = portfolioCache.get(wallet);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.payload, { headers: { 'Cache-Control': 'private, no-store', 'X-HeyStockers-Cache': 'hit' } });

  try {
    // Exactly two Alchemy calls per uncached wallet read: legacy SPL and Token-2022 accounts.
    const [legacyAccounts, token2022Accounts, prices] = await Promise.all([
      getTokenAccounts(wallet, legacyTokenProgram),
      getTokenAccounts(wallet, token2022Program),
      getStockPrices(),
    ]);
    const balances = new Map<string, { atomic: bigint; decimals: number }>();
    for (const account of [...legacyAccounts, ...token2022Accounts]) {
      const info = account.account?.data?.parsed?.info;
      const mint = info?.mint;
      if (!mint || !assetByMint.has(mint)) continue;
      const amount = BigInt(info?.tokenAmount?.amount ?? '0');
      if (amount <= 0n) continue;
      const existing = balances.get(mint);
      balances.set(mint, { atomic: (existing?.atomic ?? 0n) + amount, decimals: info?.tokenAmount?.decimals ?? assetByMint.get(mint)!.decimals });
    }

    const holdings = [...balances.entries()].map(([mint, balance]) => {
      const asset = assetByMint.get(mint)!;
      const amount = Number(balance.atomic) / 10 ** balance.decimals;
      const priceUsd = asset.symbol === 'USDC' ? 1 : prices[asset.symbol] ?? null;
      return { symbol: asset.symbol, name: asset.name, amount, priceUsd, valueUsd: priceUsd === null ? null : amount * priceUsd };
    }).sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
    const stockValueUsd = holdings.filter((holding) => holding.symbol !== 'USDC').reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0);
    const usdcValueUsd = holdings.find((holding) => holding.symbol === 'USDC')?.valueUsd ?? 0;
    const payload = {
      wallet,
      stockValueUsd,
      usdcValueUsd,
      holdings,
      prices,
      updatedAt: new Date().toISOString(),
      source: 'Token accounts + live stock routes',
      rpcCalls: { tokenAccounts: 2 },
    };
    portfolioCache.set(wallet, { payload, expiresAt: Date.now() + 15_000 });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store', 'X-HeyStockers-Cache': 'miss' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The stock wallet could not be read.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
