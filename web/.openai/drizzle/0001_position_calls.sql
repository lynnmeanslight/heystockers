CREATE TABLE IF NOT EXISTS position_calls (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  symbol TEXT NOT NULL CHECK (symbol IN ('NVDAx', 'AAPLx', 'SPYx', 'TSLAx')),
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  thesis TEXT NOT NULL CHECK (length(thesis) BETWEEN 10 AND 280),
  entry_price REAL NOT NULL CHECK (entry_price > 0),
  target_price REAL NOT NULL CHECK (target_price > 0),
  deadline TEXT NOT NULL,
  commitment_usdc REAL NOT NULL CHECK (commitment_usdc BETWEEN 1 AND 25),
  execution_signature TEXT,
  outcome TEXT NOT NULL DEFAULT 'OPEN' CHECK (outcome IN ('OPEN', 'WON', 'LOST')),
  resolved_at TEXT,
  resolved_price REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (wallet) REFERENCES wallets(wallet)
);
CREATE TABLE IF NOT EXISTS call_signals (
  call_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (call_id, wallet),
  FOREIGN KEY (call_id) REFERENCES position_calls(id),
  FOREIGN KEY (wallet) REFERENCES wallets(wallet)
);
CREATE INDEX IF NOT EXISTS idx_position_calls_created_at ON position_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_position_calls_outcome_deadline ON position_calls(outcome, deadline);
CREATE INDEX IF NOT EXISTS idx_position_calls_wallet_created_at ON position_calls(wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_position_calls_proven_created_at ON position_calls(created_at DESC) WHERE execution_signature IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_signals_call_id ON call_signals(call_id);
PRAGMA optimize;
