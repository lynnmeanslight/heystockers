import { NextResponse } from 'next/server';
import { ensureDb } from '../../../../db/client';
import { getStockPrices } from '../../../../lib/dflow-prices';
import { positionProgress, settlePositionCall, type PositionOutcome, type PositionSide } from '../../../../lib/position-calls';
import { WALLET_PATTERN } from '../../../../lib/social-auth';

type CallRow = {
  id: string;
  wallet: string;
  symbol: string;
  side: PositionSide;
  thesis: string;
  entryPrice: number;
  targetPrice: number;
  deadline: string;
  commitmentUsdc: number;
  executionSignature: string | null;
  outcome: PositionOutcome;
  resolvedAt: string | null;
  resolvedPrice: number | null;
  createdAt: string;
  signalCount: number;
  signaled: number;
  following: number;
};

type RecordRow = { wallet: string; wins: number; losses: number };

export async function GET(request: Request) {
  const candidate = new URL(request.url).searchParams.get('viewer') ?? '';
  const viewer = WALLET_PATTERN.test(candidate) ? candidate : '';
  try {
    const db = await ensureDb();
    const [callResult, prices] = await Promise.all([
      db.prepare(
        `SELECT c.id, c.wallet, c.symbol, c.side, c.thesis,
          c.entry_price AS entryPrice, c.target_price AS targetPrice,
          c.deadline, c.commitment_usdc AS commitmentUsdc,
          c.execution_signature AS executionSignature, c.outcome,
          c.resolved_at AS resolvedAt, c.resolved_price AS resolvedPrice,
          c.created_at AS createdAt,
          (SELECT COUNT(*) FROM call_signals s WHERE s.call_id = c.id) AS signalCount,
          EXISTS(SELECT 1 FROM call_signals vs WHERE vs.call_id = c.id AND vs.wallet = ?) AS signaled,
          EXISTS(SELECT 1 FROM follows f WHERE f.follower_wallet = ? AND f.following_wallet = c.wallet) AS following
        FROM position_calls c
        WHERE c.execution_signature IS NOT NULL
        ORDER BY c.created_at DESC
        LIMIT 100`,
      ).bind(viewer, viewer).all<CallRow>(),
      getStockPrices(),
    ]);

    const now = new Date();
    const calls = callResult.results.map((call) => {
      const currentPrice = prices[call.symbol] ?? null;
      const nextOutcome = call.outcome === 'OPEN' && call.executionSignature
        ? settlePositionCall(call.side, call.targetPrice, call.deadline, currentPrice, now.getTime())
        : call.outcome;
      return {
        ...call,
        currentPrice,
        outcome: nextOutcome,
        progress: positionProgress(call.side, call.entryPrice, call.targetPrice, currentPrice),
        signaled: Boolean(call.signaled),
        following: Boolean(call.following),
      };
    });

    const settled = calls.filter((call, index) => callResult.results[index]?.outcome === 'OPEN' && call.outcome !== 'OPEN' && call.currentPrice !== null);
    if (settled.length) {
      await db.batch(settled.map((call) => db.prepare(
        `UPDATE position_calls SET outcome = ?, resolved_at = ?, resolved_price = ? WHERE id = ? AND outcome = 'OPEN'`,
      ).bind(call.outcome, now.toISOString(), call.currentPrice, call.id)));
    }

    const records = await db.prepare(
      `SELECT wallet,
        SUM(CASE WHEN outcome = 'WON' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN outcome = 'LOST' THEN 1 ELSE 0 END) AS losses
      FROM position_calls
      WHERE execution_signature IS NOT NULL
      GROUP BY wallet`,
    ).all<RecordRow>();
    const recordByWallet = Object.fromEntries(records.results.map((record) => [record.wallet, { wins: record.wins, losses: record.losses }]));

    return NextResponse.json({ calls: calls.map((call) => ({ ...call, record: recordByWallet[call.wallet] ?? { wins: 0, losses: 0 } })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Position calls are unavailable.' }, { status: 503 });
  }
}
