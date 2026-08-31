type ParsedTransaction = {
  blockTime?: number | null;
  transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string; signer?: boolean }> } };
  meta?: {
    err?: unknown;
    preTokenBalances?: ParsedTokenBalance[];
    postTokenBalances?: ParsedTokenBalance[];
  };
};

type ParsedTokenBalance = {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
};

export type TradeProofRequest = {
  assetMint: string;
  usdcMint: string;
  side: 'BUY' | 'SELL';
  commitmentUsdc: number;
};

function atomicBalance(balances: ParsedTokenBalance[], owner: string, mint: string) {
  return balances
    .filter((balance) => balance.owner === owner && balance.mint === mint)
    .reduce((total, balance) => total + BigInt(balance.uiTokenAmount?.amount ?? '0'), 0n);
}

export function matchesPositionTrade(transaction: ParsedTransaction, wallet: string, request: TradeProofRequest) {
  if (transaction.meta?.err) return false;
  const pre = transaction.meta?.preTokenBalances ?? [];
  const post = transaction.meta?.postTokenBalances ?? [];
  const assetDelta = atomicBalance(post, wallet, request.assetMint) - atomicBalance(pre, wallet, request.assetMint);
  const usdcDelta = atomicBalance(post, wallet, request.usdcMint) - atomicBalance(pre, wallet, request.usdcMint);
  const minimumCommitment = BigInt(Math.floor(request.commitmentUsdc * 1_000_000 * 0.95));

  return request.side === 'BUY'
    ? assetDelta > 0n && usdcDelta < 0n && -usdcDelta >= minimumCommitment
    : assetDelta < 0n && usdcDelta > 0n && usdcDelta >= minimumCommitment;
}

function wait(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

export async function verifyTradeTransaction(signature: string, wallet: string, request: TradeProofRequest) {
  const rpcUrl = process.env.SOLANA_TOKEN_RPC_URL;
  if (!rpcUrl) throw new Error('Trade proof verification is not configured.');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Trade proof verification is unavailable.');
    const payload = await response.json() as { result?: ParsedTransaction | null };
    if (!payload.result) {
      if (attempt < 2) await wait(600);
      continue;
    }

    const keys = payload.result.transaction?.message?.accountKeys ?? [];
    const signedByWallet = keys.some((key, index) => typeof key === 'string' ? index === 0 && key === wallet : key.pubkey === wallet && key.signer === true);
    const matchingTrade = matchesPositionTrade(payload.result, wallet, request);
    return { valid: signedByWallet && matchingTrade, blockTime: payload.result.blockTime ?? null };
  }
  return { valid: false, blockTime: null };
}
