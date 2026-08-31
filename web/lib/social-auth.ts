import { ensureDb } from '../db/client';
export { WALLET_PATTERN } from './validation';

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getAuthenticatedWallet(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const db = await ensureDb();
  const tokenHash = await hashToken(token);
  const row = await db.prepare(
    `SELECT wallet FROM sessions WHERE token_hash = ? AND expires_at > ?`,
  ).bind(tokenHash, new Date().toISOString()).first<{ wallet: string }>();
  return row?.wallet ?? null;
}
