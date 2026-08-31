import { NextResponse } from 'next/server';
import { ensureDb } from '../../../../db/client';
import { getAuthenticatedWallet } from '../../../../lib/social-auth';

export async function POST(request: Request) {
  const wallet = await getAuthenticatedWallet(request);
  if (!wallet) return NextResponse.json({ error: 'Verify your wallet before signaling.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { callId?: string };
  const callId = body.callId?.trim() ?? '';
  if (!callId) return NextResponse.json({ error: 'Call id is required.' }, { status: 400 });

  const db = await ensureDb();
  const call = await db.prepare(`SELECT id FROM position_calls WHERE id = ?`).bind(callId).first<{ id: string }>();
  if (!call) return NextResponse.json({ error: 'Position call not found.' }, { status: 404 });
  const existing = await db.prepare(`SELECT 1 AS found FROM call_signals WHERE call_id = ? AND wallet = ?`).bind(callId, wallet).first<{ found: number }>();
  if (existing) {
    await db.prepare(`DELETE FROM call_signals WHERE call_id = ? AND wallet = ?`).bind(callId, wallet).run();
    return NextResponse.json({ reacted: false });
  }
  await db.prepare(`INSERT INTO call_signals (call_id, wallet, created_at) VALUES (?, ?, ?)`).bind(callId, wallet, new Date().toISOString()).run();
  return NextResponse.json({ reacted: true });
}
