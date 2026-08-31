import { NextResponse } from 'next/server';
import { ensureDb } from '../../../../db/client';
import { WALLET_PATTERN } from '../../../../lib/social-auth';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { wallet?: string };
  const wallet = body.wallet?.trim() ?? '';
  if (!WALLET_PATTERN.test(wallet)) return NextResponse.json({ error: 'Wallet address is not valid.' }, { status: 400 });

  const db = await ensureDb();
  const challengeId = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 5 * 60_000);
  const message = [
    'HeyStockers Stock SocialFi',
    `Wallet: ${wallet}`,
    `Challenge: ${challengeId}`,
    `Expires: ${expiresAt.toISOString()}`,
    'Purpose: verify this wallet for social actions. This does not submit a transaction.',
  ].join('\n');

  await db.prepare(
    `INSERT INTO auth_challenges (id, wallet, message, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).bind(challengeId, wallet, message, expiresAt.toISOString(), createdAt.toISOString()).run();

  return NextResponse.json({ challengeId, message, expiresAt: expiresAt.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
