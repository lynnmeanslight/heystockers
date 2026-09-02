CREATE TABLE IF NOT EXISTS price_snapshots (
  symbol TEXT NOT NULL,
  price REAL NOT NULL CHECK (price > 0),
  captured_at TEXT NOT NULL,
  PRIMARY KEY (symbol, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_captured_at ON price_snapshots(captured_at);
