import { PublicKey } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import { verifyChallenge } from '../src/auth'

const keypair = nacl.sign.keyPair()
const wallet = new PublicKey(keypair.publicKey).toBase58()
const challengeId = 'b1946ac9-2ee1-4bbf-94b4-716ac5a1f0d1'
const storedMessage = [
  'HeyStockers Stock SocialFi',
  'Domain: heystockers.trade',
  `Wallet: ${wallet}`,
  `Challenge: ${challengeId}`,
  'Expires: 2099-01-01T00:00:00.000Z',
  'Purpose: verify this wallet for social actions. This does not submit a transaction.',
].join('\n')

function stubDb() {
  return {
    prepare(sql: string) {
      return {
        bind: () => ({
          first: async () => sql.startsWith('SELECT message') ? { message: storedMessage, expiresAt: '2099-01-01T00:00:00.000Z' } : null,
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }
    },
    batch: async () => [],
  } as unknown as D1Database
}

function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

function siwsText(overrides: { domain?: string; nonce?: string; address?: string } = {}) {
  return [
    `${overrides.domain ?? 'heystockers.trade'} wants you to sign in with your Solana account:`,
    overrides.address ?? wallet,
    '',
    'Verify this wallet for social actions. This does not submit a transaction.',
    '',
    'Version: 1',
    'Chain ID: mainnet',
    `Nonce: ${overrides.nonce ?? challengeId}`,
    'Issued At: 2026-09-03T00:00:00.000Z',
  ].join('\n')
}

describe('sign in with solana', () => {
  it('accepts a wallet-composed SIWS message carrying our domain and nonce', async () => {
    const signedMessage = new TextEncoder().encode(siwsText())
    const signature = nacl.sign.detached(signedMessage, keypair.secretKey)
    const session = await verifyChallenge(stubDb(), {
      wallet, challengeId, signature: base64(signature), signedMessage: base64(signedMessage),
    })
    expect(session.wallet).toBe(wallet)
    expect(session.token.length).toBeGreaterThan(40)
  })

  it.each([
    ['foreign domain', siwsText({ domain: 'evil.example' })],
    ['foreign nonce', siwsText({ nonce: 'another-nonce' })],
  ])('rejects a SIWS message with a %s', async (_label, text) => {
    const signedMessage = new TextEncoder().encode(text)
    const signature = nacl.sign.detached(signedMessage, keypair.secretKey)
    await expect(verifyChallenge(stubDb(), {
      wallet, challengeId, signature: base64(signature), signedMessage: base64(signedMessage),
    })).rejects.toSatisfy((error: unknown) => error instanceof Response && error.status === 401)
  })

  it('still accepts the legacy signMessage flow over the stored challenge', async () => {
    const signature = nacl.sign.detached(new TextEncoder().encode(storedMessage), keypair.secretKey)
    const session = await verifyChallenge(stubDb(), { wallet, challengeId, signature: base64(signature) })
    expect(session.wallet).toBe(wallet)
  })
})
