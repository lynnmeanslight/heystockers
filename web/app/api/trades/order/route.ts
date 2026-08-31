import { NextResponse } from 'next/server';
import { TRADE_ASSETS, USDC } from '../../../../lib/assets';

const allowedMints = new Set([USDC.mint, ...TRADE_ASSETS.map((asset) => asset.mint)]);
const baseUrl = process.env.DFLOW_TRADE_API_URL ?? 'https://dev-quote-api.dflow.net';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const inputMint = url.searchParams.get('inputMint') ?? '';
  const outputMint = url.searchParams.get('outputMint') ?? '';
  const amount = url.searchParams.get('amount') ?? '';
  const userPublicKey = url.searchParams.get('userPublicKey') ?? '';

  if (!allowedMints.has(inputMint) || !allowedMints.has(outputMint) || inputMint === outputMint) {
    return NextResponse.json({ error: 'Unsupported trading pair.' }, { status: 400 });
  }
  if (!/^\d+$/.test(amount) || amount === '0') {
    return NextResponse.json({ error: 'Amount must be a positive atomic integer.' }, { status: 400 });
  }
  if (userPublicKey && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(userPublicKey)) {
    return NextResponse.json({ error: 'Wallet address is not valid.' }, { status: 400 });
  }

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: 'auto',
    prioritizationFeeLamports: 'auto',
  });
  if (userPublicKey) params.set('userPublicKey', userPublicKey);

  const headers = new Headers({ Accept: 'application/json' });
  if (process.env.DFLOW_API_KEY) headers.set('x-api-key', process.env.DFLOW_API_KEY);

  try {
    const response = await fetch(`${baseUrl}/order?${params.toString()}`, {
      headers,
      cache: 'no-store',
    });
    const payload = await response.json();
    return NextResponse.json(payload, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Live execution is temporarily unavailable. No order was created.' },
      { status: 502 },
    );
  }
}
