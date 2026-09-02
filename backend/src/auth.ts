import { PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { WALLET_PATTERN } from './assets'

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function authenticatedWallet(db: D1Database, authorization: string | undefined) {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) return null
  const tokenHash = await hashToken(token)
  const row = await db.prepare(
    'SELECT wallet FROM sessions WHERE token_hash = ? AND expires_at > ?',
  ).bind(tokenHash, new Date().toISOString()).first<{ wallet: string }>()
  return row?.wallet ?? null
}

// Binding the domain into the signed message lets users spot a phishing site
// relaying our challenge: the wallet popup shows a domain that is not the one
// in their address bar.
export function challengeDomain(origin: string | undefined, configuredOrigins: string | undefined) {
  const candidate = origin ?? (configuredOrigins ?? '').split(',').map((value) => value.trim()).find(Boolean) ?? ''
  try {
    return new URL(candidate).host
  } catch {
    return 'heystockers.trade'
  }
}

export async function createChallenge(db: D1Database, wallet: string, domain = 'heystockers.trade') {
  if (!WALLET_PATTERN.test(wallet)) throw new Response(JSON.stringify({ error: 'Wallet address is not valid.' }), { status: 400 })
  const challengeId = crypto.randomUUID()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + 5 * 60_000)
  const message = [
    'HeyStockers Stock SocialFi',
    `Domain: ${domain}`,
    `Wallet: ${wallet}`,
    `Challenge: ${challengeId}`,
    `Expires: ${expiresAt.toISOString()}`,
    'Purpose: verify this wallet for social actions. This does not submit a transaction.',
  ].join('\n')
  await db.prepare(
    'INSERT INTO auth_challenges (id, wallet, message, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(challengeId, wallet, message, expiresAt.toISOString(), createdAt.toISOString()).run()
  return { challengeId, message, expiresAt: expiresAt.toISOString() }
}

export async function verifyChallenge(db: D1Database, body: { wallet?: string; challengeId?: string; signature?: string; signedMessage?: string }) {
  const wallet = body.wallet?.trim() ?? ''
  const challengeId = body.challengeId?.trim() ?? ''
  const signatureBase64 = body.signature?.trim() ?? ''
  if (!WALLET_PATTERN.test(wallet) || !challengeId || !signatureBase64) {
    throw new Response(JSON.stringify({ error: 'Wallet, challenge and signature are required.' }), { status: 400 })
  }
  const now = new Date()
  const challenge = await db.prepare(
    'SELECT message, expires_at AS expiresAt FROM auth_challenges WHERE id = ? AND wallet = ? AND used_at IS NULL',
  ).bind(challengeId, wallet).first<{ message: string; expiresAt: string }>()
  if (!challenge || challenge.expiresAt <= now.toISOString()) {
    throw new Response(JSON.stringify({ error: 'This sign-in challenge is expired or already used.' }), { status: 401 })
  }
  try {
    const signature = Uint8Array.from(atob(signatureBase64), (character) => character.charCodeAt(0))
    // SIWS wallets compose and sign their own standard message, so verify the
    // signature over those exact bytes and require our domain, wallet, and
    // nonce inside the text. Legacy wallets sign the stored challenge message.
    const signedBytes = body.signedMessage
      ? Uint8Array.from(atob(body.signedMessage), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(challenge.message)
    if (body.signedMessage) {
      const domain = challenge.message.split('\n').find((line) => line.startsWith('Domain: '))?.slice('Domain: '.length) ?? 'heystockers.trade'
      const text = new TextDecoder().decode(signedBytes)
      const intro = `${domain} wants you to sign in with your Solana account:\n${wallet}`
      if (!text.startsWith(intro) || !text.includes(`Nonce: ${challengeId}`)) throw new Error('siws mismatch')
    }
    const valid = nacl.sign.detached.verify(signedBytes, signature, new PublicKey(wallet).toBytes())
    if (!valid) throw new Error('invalid')
  } catch {
    throw new Response(JSON.stringify({ error: 'The wallet signature is not valid.' }), { status: 401 })
  }
  const used = await db.prepare(
    'UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?',
  ).bind(now.toISOString(), challengeId, now.toISOString()).run()
  if (!used.meta.changes) throw new Response(JSON.stringify({ error: 'This sign-in challenge was already used.' }), { status: 401 })

  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
  const tokenHash = await hashToken(token)
  const sessionExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString()
  await db.batch([
    db.prepare('INSERT INTO wallets (wallet, joined_at) VALUES (?, ?) ON CONFLICT(wallet) DO NOTHING').bind(wallet, now.toISOString()),
    db.prepare('INSERT INTO sessions (token_hash, wallet, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(tokenHash, wallet, sessionExpiry, now.toISOString()),
    // Cap live sessions per wallet so a signing loop cannot grow the table.
    db.prepare(
      `DELETE FROM sessions WHERE wallet = ?1 AND (expires_at <= ?2 OR token_hash NOT IN (
         SELECT token_hash FROM sessions WHERE wallet = ?1 ORDER BY created_at DESC LIMIT 5))`,
    ).bind(wallet, now.toISOString()),
  ])
  return { token, wallet, expiresAt: sessionExpiry }
}

export async function revokeSession(db: D1Database, authorization: string | undefined) {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) return false
  const result = await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run()
  return result.meta.changes > 0
}
