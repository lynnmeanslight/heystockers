CREATE TABLE IF NOT EXISTS profiles (
  wallet TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  referral_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (wallet) REFERENCES wallets(wallet) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS referrals (
  referred_wallet TEXT PRIMARY KEY,
  referrer_wallet TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (referred_wallet != referrer_wallet),
  FOREIGN KEY (referred_wallet) REFERENCES profiles(wallet) ON DELETE CASCADE,
  FOREIGN KEY (referrer_wallet) REFERENCES profiles(wallet) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_wallet ON referrals(referrer_wallet, created_at DESC);
