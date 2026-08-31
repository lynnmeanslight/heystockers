import { PublicKey } from '@solana/web3.js';
import { NextResponse } from 'next/server';
import nacl from 'tweetnacl';
import { ensureDb } from '../../../../db/client';
import { hashToken, WALLET_PATTERN } from '../../../../lib/social-auth';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { wallet?: string; challengeId?: string; signature?: string };
  const wallet = body.wallet?.trim() ?? '';
  const challengeId = body.challengeId?.trim() ?? '';
  const signatureBase64 = body.signature?.trim() ?? '';
  if (!WALLET_PATTERN.test(wallet) || !challengeId || !signatureBase64) {
    return NextResponse.json({ error: 'Wallet, challenge and signature are required.' }, { status: 400 });
  }

  const db = await ensureDb();
  const challenge = await db.prepare(
    `SELECT message, expires_at AS expiresAt FROM auth_challenges WHERE id = ? AND wallet = ? AND used_at IS NULL`,
  ).bind(challengeId, wallet).first<{ message: string; expiresAt: string }>();
  if (!challenge || challenge.expiresAt <= new Date().toISOString()) {
    return NextResponse.json({ error: 'This sign-in challenge is expired or already used.' }, { status: 401 });
  }

  try {
    const signature = Uint8Array.from(atob(signatureBase64), (character) => character.charCodeAt(0));
    const message = new TextEncoder().encode(challenge.message);
    const publicKey = new PublicKey(wallet).toBytes();
    if (!nacl.sign.detached.verify(message, signature, publicKey)) {
      return NextResponse.json({ error: 'The wallet signature is not valid.' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'The wallet signature could not be decoded.' }, { status: 400 });
  }

  const now = new Date();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const tokenHash = await hashToken(token);
  const sessionExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString();
  await db.batch([
    db.prepare(`UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL`).bind(now.toISOString(), challengeId),
    db.prepare(`INSERT INTO wallets (wallet, joined_at) VALUES (?, ?) ON CONFLICT(wallet) DO NOTHING`).bind(wallet, now.toISOString()),
    db.prepare(`INSERT INTO sessions (token_hash, wallet, expires_at, created_at) VALUES (?, ?, ?, ?)`).bind(tokenHash, wallet, sessionExpiry, now.toISOString()),
  ]);

  return NextResponse.json({ token, wallet, expiresAt: sessionExpiry }, { headers: { 'Cache-Control': 'no-store' } });
}
