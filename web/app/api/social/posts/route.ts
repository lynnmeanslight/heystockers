import { NextResponse } from 'next/server';
import { ensureDb } from '../../../../db/client';
import { TRADE_ASSETS, USDC } from '../../../../lib/assets';
import { getStockPrices } from '../../../../lib/dflow-prices';
import { targetMatchesSide, type PositionSide } from '../../../../lib/position-calls';
import { getAuthenticatedWallet } from '../../../../lib/social-auth';
import { verifyTradeTransaction } from '../../../../lib/solana-proof';

const symbols = new Set(TRADE_ASSETS.map((asset) => asset.symbol));
const sides = new Set<PositionSide>(['BUY', 'SELL']);
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

export async function POST(request: Request) {
  const wallet = await getAuthenticatedWallet(request);
  if (!wallet) return NextResponse.json({ error: 'Verify your wallet before publishing a call.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { symbol?: string; side?: PositionSide; targetPrice?: number; deadline?: string; commitmentUsdc?: number; thesis?: string; signature?: string };
  const symbol = body.symbol ?? '';
  const side = body.side ?? 'BUY';
  const targetPrice = Number(body.targetPrice);
  const commitmentUsdc = Number(body.commitmentUsdc);
  const thesis = body.thesis?.trim() ?? '';
  const signature = body.signature?.trim() ?? '';
  const deadline = new Date(body.deadline ?? '');
  const now = Date.now();

  if (!symbols.has(symbol) || !sides.has(side)) return NextResponse.json({ error: 'Choose Buy or Sell on a supported stock.' }, { status: 400 });
  if (!SIGNATURE_PATTERN.test(signature)) return NextResponse.json({ error: 'Complete the matching wallet trade before publishing.' }, { status: 400 });
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return NextResponse.json({ error: 'Enter a valid target price.' }, { status: 400 });
  if (!Number.isFinite(commitmentUsdc) || commitmentUsdc < 1 || commitmentUsdc > 25) return NextResponse.json({ error: 'Commit between $1 and $25.' }, { status: 400 });
  if (thesis.length < 10 || thesis.length > 280) return NextResponse.json({ error: 'Explain the call in 10–280 characters.' }, { status: 400 });
  if (!Number.isFinite(deadline.getTime()) || deadline.getTime() < now + 60 * 60 * 1000 || deadline.getTime() > now + 31 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'Choose a deadline between 1 hour and 31 days.' }, { status: 400 });
  }

  const db = await ensureDb();
  const usedProof = await db.prepare(
    `SELECT id FROM position_calls WHERE execution_signature = ?`,
  ).bind(signature).first<{ id: string }>();
  if (usedProof) return NextResponse.json({ error: 'This trade already backs a position call.' }, { status: 409 });

  const entryPrice = (await getStockPrices())[symbol] ?? null;
  if (entryPrice === null) return NextResponse.json({ error: 'A live entry price is required. Try again shortly.' }, { status: 503 });
  if (!targetMatchesSide(side, entryPrice, targetPrice)) {
    return NextResponse.json({ error: side === 'BUY' ? 'A Buy target must be above the entry price.' : 'A Sell target must be below the entry price.' }, { status: 400 });
  }

  const asset = TRADE_ASSETS.find((candidate) => candidate.symbol === symbol);
  const proof = asset
    ? await verifyTradeTransaction(signature, wallet, {
        assetMint: asset.mint,
        usdcMint: USDC.mint,
        side,
        commitmentUsdc,
      })
    : { valid: false, blockTime: null };
  const tradeTime = proof.blockTime === null ? null : proof.blockTime * 1000;
  const recent = tradeTime !== null && tradeTime >= now - 15 * 60_000 && tradeTime <= now + 60_000;
  if (!proof.valid || !recent) {
    return NextResponse.json({ error: 'The confirmed trade must match this stock, direction, and commitment.' }, { status: 409 });
  }

  const call = {
    id: crypto.randomUUID(), wallet, symbol, side, thesis, entryPrice, targetPrice,
    deadline: deadline.toISOString(), commitmentUsdc, signature, createdAt: new Date(now).toISOString(),
  };
  try {
    await db.prepare(
      `INSERT INTO position_calls (id, wallet, symbol, side, thesis, entry_price, target_price, deadline, commitment_usdc, execution_signature, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(call.id, call.wallet, call.symbol, call.side, call.thesis, call.entryPrice, call.targetPrice, call.deadline, call.commitmentUsdc, call.signature, call.createdAt).run();
  } catch {
    return NextResponse.json({ error: 'This trade already backs a position call.' }, { status: 409 });
  }
  return NextResponse.json({ call }, { status: 201 });
}
