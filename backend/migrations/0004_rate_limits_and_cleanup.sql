CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  resets_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_resets_at ON rate_limits(resets_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_wallet_created_at ON sessions(wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at ON auth_challenges(expires_at);
