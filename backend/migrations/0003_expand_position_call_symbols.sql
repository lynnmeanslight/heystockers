-- Supported stocks are owned by the API catalog. Rebuild the table to remove the
-- legacy four-symbol database check while retaining all calls and signal links.
PRAGMA defer_foreign_keys = on;

CREATE TABLE position_calls_expanded (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  symbol TEXT NOT NULL,
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

INSERT INTO position_calls_expanded (
  id, wallet, symbol, side, thesis, entry_price, target_price, deadline,
  commitment_usdc, execution_signature, outcome, resolved_at, resolved_price, created_at
)
SELECT
  id, wallet, symbol, side, thesis, entry_price, target_price, deadline,
  commitment_usdc, execution_signature, outcome, resolved_at, resolved_price, created_at
FROM position_calls;

DROP TABLE position_calls;
ALTER TABLE position_calls_expanded RENAME TO position_calls;

CREATE INDEX idx_position_calls_created_at ON position_calls(created_at DESC);
CREATE INDEX idx_position_calls_outcome_deadline ON position_calls(outcome, deadline);
CREATE INDEX idx_position_calls_wallet_created_at ON position_calls(wallet, created_at DESC);
CREATE INDEX idx_position_calls_proven_created_at ON position_calls(created_at DESC) WHERE execution_signature IS NOT NULL;
CREATE UNIQUE INDEX idx_position_calls_execution_signature ON position_calls(execution_signature) WHERE execution_signature IS NOT NULL;

PRAGMA defer_foreign_keys = off;
PRAGMA optimize;
