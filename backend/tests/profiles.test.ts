import { describe, expect, it } from 'vitest'
import {
  deleteAccountData,
  normalizeReferralCode,
  normalizeSearchQuery,
  normalizeUsername,
  referralCodeFromBytes,
  usernameError,
} from '../src/profiles'

describe('usernames', () => {
  it('normalizes handles and accepts the supported format', () => {
    expect(normalizeUsername('  @Trader_One ')).toBe('trader_one')
    expect(usernameError('trader_one')).toBeNull()
  })

  it('rejects unsafe, short, and reserved names', () => {
    expect(usernameError('ab')).toBeTruthy()
    expect(usernameError('1trader')).toBeTruthy()
    expect(usernameError('support')).toBeTruthy()
    expect(usernameError('trader-name')).toBeTruthy()
  })

  it('only searches normalized username fragments', () => {
    expect(normalizeSearchQuery('@trader')).toBe('trader')
    expect(normalizeSearchQuery('%')).toBe('')
  })
})

describe('referrals', () => {
  it('creates stable-format public referral codes', () => {
    const code = referralCodeFromBytes(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))
    expect(code).toMatch(/^HS[A-Z2-9]{8}$/)
    expect(normalizeReferralCode(code.toLowerCase())).toBe(code)
  })
})

describe('account deletion', () => {
  it('removes social, session, and profile data before the wallet row', async () => {
    const statements: string[] = []
    const db = {
      prepare(sql: string) {
        statements.push(sql)
        return { bind: () => ({ sql }) }
      },
      batch: async () => undefined,
    } as unknown as D1Database

    await deleteAccountData(db, 'wallet')

    expect(statements).toHaveLength(8)
    expect(statements[0]).toContain('DELETE FROM call_signals')
    expect(statements.at(-1)).toContain('DELETE FROM wallets')
  })
})
