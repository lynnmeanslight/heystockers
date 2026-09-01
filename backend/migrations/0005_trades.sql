CREATE TABLE IF NOT EXISTS trades (
  signature TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  asset_atomic TEXT NOT NULL,
  usdc_atomic TEXT NOT NULL,
  price_usd REAL,
  block_time TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_wallet_block_time ON trades(wallet, block_time DESC);
