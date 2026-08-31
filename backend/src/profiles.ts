const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/
const REFERRAL_PATTERN = /^HS[A-Z2-9]{8}$/
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const RESERVED_USERNAMES = new Set(['admin', 'api', 'help', 'heystockers', 'moderator', 'official', 'root', 'stockers', 'support', 'system'])

type ProfileRow = {
  wallet: string
  username: string
  referralCode: string
  referralCount: number
  followerCount: number
  followingCount: number
  wins: number
  losses: number
  following: number
}

export type PublicProfile = Omit<ProfileRow, 'following'> & { following: boolean }
export type ReferralStatus = 'applied' | 'invalid' | 'none'

export class ProfileError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 503) {
    super(message)
  }
}

const PROFILE_SELECT = `SELECT p.wallet, p.username, p.referral_code AS referralCode,
  (SELECT COUNT(*) FROM referrals r WHERE r.referrer_wallet = p.wallet) AS referralCount,
  (SELECT COUNT(*) FROM follows f WHERE f.following_wallet = p.wallet) AS followerCount,
  (SELECT COUNT(*) FROM follows f WHERE f.follower_wallet = p.wallet) AS followingCount,
  (SELECT COUNT(*) FROM position_calls c WHERE c.wallet = p.wallet AND c.outcome = 'WON') AS wins,
  (SELECT COUNT(*) FROM position_calls c WHERE c.wallet = p.wallet AND c.outcome = 'LOST') AS losses,
  EXISTS(SELECT 1 FROM follows vf WHERE vf.follower_wallet = ? AND vf.following_wallet = p.wallet) AS following
FROM profiles p`

function publicProfile(row: ProfileRow | null) {
  return row ? { ...row, following: Boolean(row.following) } : null
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@/, '')
}

export function usernameError(value: string) {
  const username = normalizeUsername(value)
  if (!USERNAME_PATTERN.test(username)) return 'Use 3–20 characters, start with a letter, and use only letters, numbers or underscores.'
  if (RESERVED_USERNAMES.has(username)) return 'That username is reserved.'
  return null
}

export function normalizeReferralCode(value: string) {
  return value.trim().toUpperCase()
}

export function referralCodeFromBytes(bytes: Uint8Array) {
  return `HS${[...bytes.slice(0, 8)].map((byte) => REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length]).join('')}`
}

export function createReferralCode() {
  return referralCodeFromBytes(crypto.getRandomValues(new Uint8Array(8)))
}

export function normalizeSearchQuery(value: string) {
  const query = normalizeUsername(value)
  return /^[a-z0-9_]{2,20}$/.test(query) ? query : ''
}

export async function profileExists(db: D1Database, wallet: string) {
  return Boolean(await db.prepare('SELECT 1 AS found FROM profiles WHERE wallet = ?').bind(wallet).first())
}

export async function deleteAccountData(db: D1Database, wallet: string) {
  await db.batch([
    db.prepare(
      'DELETE FROM call_signals WHERE wallet = ? OR call_id IN (SELECT id FROM position_calls WHERE wallet = ?)',
    ).bind(wallet, wallet),
    db.prepare('DELETE FROM position_calls WHERE wallet = ?').bind(wallet),
    db.prepare('DELETE FROM follows WHERE follower_wallet = ? OR following_wallet = ?').bind(wallet, wallet),
    db.prepare('DELETE FROM referrals WHERE referred_wallet = ? OR referrer_wallet = ?').bind(wallet, wallet),
    db.prepare('DELETE FROM profiles WHERE wallet = ?').bind(wallet),
    db.prepare('DELETE FROM sessions WHERE wallet = ?').bind(wallet),
    db.prepare('DELETE FROM auth_challenges WHERE wallet = ?').bind(wallet),
    db.prepare('DELETE FROM wallets WHERE wallet = ?').bind(wallet),
  ])
}

export async function getProfileByWallet(db: D1Database, wallet: string, viewer = '') {
  const row = await db.prepare(`${PROFILE_SELECT} WHERE p.wallet = ?`).bind(viewer, wallet).first<ProfileRow>()
  return publicProfile(row)
}

export async function searchProfiles(db: D1Database, rawQuery: string, viewer = '') {
  const query = normalizeSearchQuery(rawQuery)
  if (!query) return []
  const result = await db.prepare(
    `${PROFILE_SELECT}
     WHERE p.username LIKE ?
     ORDER BY CASE WHEN p.username LIKE ? THEN 0 ELSE 1 END, referralCount DESC, p.username ASC
     LIMIT 20`,
  ).bind(viewer, `%${query}%`, `${query}%`).all<ProfileRow>()
  return result.results.map((row) => publicProfile(row)!)
}

export async function saveProfile(db: D1Database, wallet: string, rawUsername: string, rawReferralCode = '') {
  const username = normalizeUsername(rawUsername)
  const validationError = usernameError(username)
  if (validationError) throw new ProfileError(validationError, 400)

  const owner = await db.prepare('SELECT wallet FROM profiles WHERE username = ? COLLATE NOCASE').bind(username).first<{ wallet: string }>()
  if (owner && owner.wallet !== wallet) throw new ProfileError('That username is already taken.', 409)

  const existing = await db.prepare('SELECT wallet FROM profiles WHERE wallet = ?').bind(wallet).first()
  const now = new Date().toISOString()
  if (existing) {
    await db.prepare('UPDATE profiles SET username = ?, updated_at = ? WHERE wallet = ?').bind(username, now, wallet).run()
    return { profile: (await getProfileByWallet(db, wallet, wallet))!, created: false, referralStatus: 'none' as ReferralStatus }
  }

  const requestedCode = normalizeReferralCode(rawReferralCode)
  const referrer = REFERRAL_PATTERN.test(requestedCode)
    ? await db.prepare('SELECT wallet FROM profiles WHERE referral_code = ? COLLATE NOCASE').bind(requestedCode).first<{ wallet: string }>()
    : null
  const referralStatus: ReferralStatus = requestedCode ? (referrer && referrer.wallet !== wallet ? 'applied' : 'invalid') : 'none'

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const referralCode = createReferralCode()
    const statements = [
      db.prepare('INSERT INTO profiles (wallet, username, referral_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind(wallet, username, referralCode, now, now),
    ]
    if (referralStatus === 'applied' && referrer) {
      statements.push(db.prepare('INSERT INTO referrals (referred_wallet, referrer_wallet, created_at) VALUES (?, ?, ?)').bind(wallet, referrer.wallet, now))
    }
    try {
      await db.batch(statements)
      return { profile: (await getProfileByWallet(db, wallet, wallet))!, created: true, referralStatus }
    } catch {
      const usernameOwner = await db.prepare('SELECT wallet FROM profiles WHERE username = ? COLLATE NOCASE').bind(username).first<{ wallet: string }>()
      if (usernameOwner) throw new ProfileError('That username is already taken.', 409)
    }
  }
  throw new ProfileError('A referral code could not be created. Try again.', 503)
}
