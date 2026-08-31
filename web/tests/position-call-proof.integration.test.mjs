import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import test from 'node:test';

const API_URL = process.env.HEYSTOCKERS_TEST_URL ?? 'http://localhost:3000';
const DB_DIRECTORY = new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url);
const WALLET = '8dZZqYCJdyk9XJG3WaaphpLRgzoC9bEMu3nncmEKMcf1';
const TOKEN = 'local-position-call-proof-test';

function openLocalDb() {
  const filename = readdirSync(DB_DIRECTORY).find((candidate) => candidate.endsWith('.sqlite') && candidate !== 'metadata.sqlite');
  assert.ok(filename, 'Start the local web server once so its D1 database exists.');
  return new DatabaseSync(new URL(filename, DB_DIRECTORY));
}

test('a position call cannot be created before its trade proof exists', async () => {
  const db = openLocalDb();
  const tokenHash = createHash('sha256').update(TOKEN).digest('hex');
  const now = new Date();
  db.prepare('INSERT OR IGNORE INTO wallets (wallet, joined_at) VALUES (?, ?)').run(WALLET, now.toISOString());
  db.prepare('INSERT OR REPLACE INTO sessions (token_hash, wallet, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    WALLET,
    new Date(now.getTime() + 60_000).toISOString(),
    now.toISOString(),
  );

  const before = db.prepare('SELECT COUNT(*) AS count FROM position_calls WHERE wallet = ?').get(WALLET).count;
  const quoteResponse = await fetch(`${API_URL}/api/stocks/quotes`);
  const quote = await quoteResponse.json();
  assert.ok(quote.prices?.NVDAx, 'A live NVDAx price is required for this integration check.');

  const response = await fetch(`${API_URL}/api/social/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: 'NVDAx',
      side: 'BUY',
      targetPrice: quote.prices.NVDAx * 1.05,
      deadline: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      commitmentUsdc: 10,
      thesis: 'This must never be stored unless its matching wallet trade succeeds.',
    }),
  });
  const payload = await response.json();
  const after = db.prepare('SELECT COUNT(*) AS count FROM position_calls WHERE wallet = ?').get(WALLET).count;

  if (payload.call?.id) db.prepare('DELETE FROM position_calls WHERE id = ?').run(payload.call.id);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  db.close();

  assert.equal(response.status, 400);
  assert.equal(after, before);
});
