import { NextResponse } from 'next/server';
import { ensureDb } from '../../../../db/client';
import { getAuthenticatedWallet, WALLET_PATTERN } from '../../../../lib/social-auth';

export async function POST(request: Request) {
  const follower = await getAuthenticatedWallet(request);
  if (!follower) return NextResponse.json({ error: 'Verify your wallet before following.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { wallet?: string };
  const following = body.wallet?.trim() ?? '';
  if (!WALLET_PATTERN.test(following) || following === follower) return NextResponse.json({ error: 'Choose another verified wallet.' }, { status: 400 });

  const db = await ensureDb();
  const target = await db.prepare(`SELECT wallet FROM wallets WHERE wallet = ?`).bind(following).first<{ wallet: string }>();
  if (!target) return NextResponse.json({ error: 'This wallet has not joined HeyStockers.' }, { status: 404 });
  const existing = await db.prepare(`SELECT 1 AS found FROM follows WHERE follower_wallet = ? AND following_wallet = ?`).bind(follower, following).first<{ found: number }>();
  if (existing) {
    await db.prepare(`DELETE FROM follows WHERE follower_wallet = ? AND following_wallet = ?`).bind(follower, following).run();
    return NextResponse.json({ following: false });
  }
  await db.prepare(`INSERT INTO follows (follower_wallet, following_wallet, created_at) VALUES (?, ?, ?)`).bind(follower, following, new Date().toISOString()).run();
  return NextResponse.json({ following: true });
}
