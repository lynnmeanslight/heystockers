CREATE TABLE IF NOT EXISTS wallets (
  wallet TEXT PRIMARY KEY,
  joined_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (wallet) REFERENCES wallets(wallet)
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  symbol TEXT NOT NULL CHECK (symbol IN ('NVDAx', 'AAPLx', 'SPYx', 'TSLAx')),
  stance TEXT NOT NULL CHECK (stance IN ('BUY', 'HOLD', 'SELL')),
  thesis TEXT NOT NULL CHECK (length(thesis) BETWEEN 10 AND 280),
  conviction INTEGER NOT NULL CHECK (conviction BETWEEN 1 AND 5),
  created_at TEXT NOT NULL,
  FOREIGN KEY (wallet) REFERENCES wallets(wallet)
);
CREATE TABLE IF NOT EXISTS reactions (
  post_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, wallet),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (wallet) REFERENCES wallets(wallet)
);
CREATE TABLE IF NOT EXISTS follows (
  follower_wallet TEXT NOT NULL,
  following_wallet TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_wallet, following_wallet),
  CHECK (follower_wallet != following_wallet),
  FOREIGN KEY (follower_wallet) REFERENCES wallets(wallet),
  FOREIGN KEY (following_wallet) REFERENCES wallets(wallet)
);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactions_post_id ON reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_wallet ON follows(follower_wallet);
PRAGMA optimize;
