# HeyStockers

HeyStockers is a stock-only SocialFi network on Solana. People publish tokenized-stock theses under a verified wallet identity, follow analysts, signal useful calls, and buy or sell xStocks through DFlow without giving up custody.

## What works

- Public stock-thesis feed backed by Cloudflare D1
- Replay-protected Phantom message signing for social identity
- Real follows and peer signals; no seeded accounts, posts, or engagement
- Stock calls with BUY, HOLD, SELL, and 1–5 conviction
- Live xStock holdings and USDC buying power from Solana
- Buy and sell flows for NVDAx, AAPLx, SPYx and TSLAx
- Backend-proxied DFlow `/order` quotes
- User-signed Solana transactions returned by DFlow
- $25 per-trade UI guardrail and an allowlist of supported mints
- Exactly two Alchemy calls for each uncached wallet read: SPL and Token-2022
- Responsive desktop and mobile layouts

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## DFlow configuration

The default developer endpoint needs no API key but is rate-limited. Copy `.env.example` to `.env.local` and add `DFLOW_API_KEY` before production use.

HeyStockers uses the configured Alchemy endpoint only for two token-account discovery calls: SPL Token and Token-2022. It discards every mint outside the enabled xStocks and USDC, caches each stock-only wallet snapshot for 15 seconds, and caches DFlow prices for 60 seconds. Orders pass through the allowlisted `/api/dflow/order` route. Private keys never reach HeyStockers.

## Social data

`.openai/hosting.json` declares the `DB` D1 binding. The schema and production migration live in `db/schema.ts` and `.openai/drizzle/0000_stock_social.sql`. Local development initializes the same tables automatically.

## Safety and product boundaries

- Every live trade requires explicit wallet approval.
- HeyStockers is not a custodian, broker or investment adviser.
- Tokenized equities are blockchain tokens, not brokerage shares.
- Eligibility depends on the user's jurisdiction.
- No sample balances, profiles, posts, reactions, or network counts are displayed.
- The portfolio value includes xStocks only. USDC is shown separately as buying power; SOL and unrelated tokens are intentionally ignored.
