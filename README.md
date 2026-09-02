# HeyStockers

> Trade tokenized stocks on Solana and build an on-chain reputation you can't fake.

HeyStockers is a stock-only SocialFi product on Solana. You buy and sell tokenized
US stocks (xStocks) straight from your own wallet, non-custodially, and back your
convictions with **Position Calls**: public predictions that go live only after the
matching trade is verified on-chain. There are no seeded posts, no model portfolios,
and no invented balances. Everything on screen is real wallet activity.

- **Web:** https://heystockers.trade
- **API:** https://api.heystockers.trade ( [/health](https://api.heystockers.trade/health) · [/ready](https://api.heystockers.trade/ready) )
- **Mobile:** Android-first for the Solana dApp Store (Seeker), package `com.heystockers.mobile`

## Contents

- [What it does](#what-it-does)
- [Repository layout](#repository-layout)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Backend API](#backend-api)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Security](#security)
- [Testing](#testing)
- [Disclaimer](#disclaimer)

## What it does

- **Non-custodial trading.** Buy and sell 42 tokenized US stocks and ETFs (xStocks)
  with USDC. You approve every transaction in your own wallet; keys never touch HeyStockers.
- **Real portfolio.** Live prices, your actual xStock holdings, and USDC buying power,
  read directly from Solana. SOL and unrelated tokens are intentionally excluded.
- **Position Calls, the reputation engine.** Pick a stock, choose BUY or SELL, set a
  target price, a deadline (1 hour to 31 days), a $1 to $25 USDC stake, and write a
  thesis. The call publishes only after the backend confirms the matching on-chain
  trade, so rejecting the wallet transaction posts nothing. Calls settle automatically
  against live prices into a public win/loss record.
- **Identity and social graph.** Wallet-verified usernames, referral links, follows,
  and "agree" signals. No fake accounts or engagement.
- **Trade history.** Every recorded swap and every call, with staked P&L.

## Repository layout

| Path | What it is | Stack |
| --- | --- | --- |
| [`backend/`](backend/) | Standalone API and settlement authority | [Hono](https://hono.dev) on Cloudflare Workers + D1 |
| [`web/`](web/) | Web client | Vinext (Next.js 16), React 19, Cloudflare Vite plugin |
| [`mobile/`](mobile/) | Android app | Expo 57, React Native 0.86, Mobile Wallet Adapter |

The `backend/` Worker at `api.heystockers.trade` is the production source of truth for
auth, quotes, portfolio, orders, trade proof, and the social graph. Both the web and
mobile clients call it. The transitional `web/app/api/**` routes remain as a
configuration-only rollback path.

## How it works

```
 Web / Mobile client
        │  wallet-signed requests over HTTPS
        ▼
 heystockers-api  (Cloudflare Worker, Hono)
   ├─ Wallet challenge auth + 7-day hashed sessions
   ├─ Quotes & executable orders  ── quote/order provider
   ├─ Portfolio reads             ── token-account RPC (2 calls / uncached wallet)
   ├─ Trade proof verification    ── separate general-purpose RPC
   ├─ Position Calls, profiles, follows, signals, trade history
   └─ D1 (SQLite)  ── shared with the web Worker
        ▲
   * * * * * cron: settle open calls, purge expired sessions/challenges/rate-limits
```

Design rules worth knowing before you touch the code:

- **RPC isolation.** The paid token-account RPC is used only for exactly two
  `getTokenAccountsByOwner` calls (SPL Token and Token-2022) on an uncached wallet read.
  Transaction proof uses a separate general-purpose RPC. Stock-only portfolio snapshots
  are cached for 15 seconds; quotes for up to 60 seconds.
- **Allowlist.** Only the 42 supported xStock mints plus USDC are ever indexed, priced,
  traded, or accepted as trade proof.
- **Proof before publish.** A Position Call requires a confirmed, matching on-chain trade
  (right stock, direction, and commitment) before it becomes public.
- **Real data only.** No mock balances, seeded posts, follower counts, or placeholders.

## Quick start

**Prerequisites:** Node.js >= 22.13, npm. For the mobile app you also need the Android
SDK and JDK 17 (Android Gradle does not support newer JDKs).

### Backend

```bash
cd backend
cp .dev.vars.example .dev.vars      # fill in RPC endpoints; never commit real values
npm install
npm run db:migrate:local
npm run dev                         # http://localhost:8787
```

Check `GET /health` and `GET /ready`.

### Web

```bash
cd web
cp .env.example .env.local          # optional local overrides
npm install
npm run dev                         # http://localhost:3000
```

With `NEXT_PUBLIC_HEYSTOCKERS_API_URL` unset, the web client falls back to its local
`/api` routes. Production builds inject `https://api.heystockers.trade`.

### Mobile

```bash
cd mobile
cp .env.example .env
npm install
npm run android                     # Android dev build (not Expo Go)
```

Wallet actions require a native dev or release build and a Mobile Wallet Adapter wallet;
Expo Go cannot provide the adapter. The emulator reaches a local web server at
`http://10.0.2.2:3000`; a device or store build must point
`EXPO_PUBLIC_HEYSTOCKERS_API_URL` at a reachable HTTPS backend (production defaults to
`https://api.heystockers.trade`). For a local release APK on Apple Silicon:

```bash
cd mobile/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
```

## Backend API

All routes are served under `api.heystockers.trade`. Reads are public; writes require a
`Authorization: Bearer <session token>` obtained from the wallet challenge flow.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health`, `/ready` | Liveness and D1 readiness |
| POST | `/api/auth/challenge` | Start wallet sign-in (returns a message to sign) |
| POST | `/api/auth/verify` | Verify the signature, issue a 7-day session |
| POST | `/api/auth/logout` | Revoke the session |
| GET | `/api/profiles/by-wallet`, `/api/profiles/search`, `/api/profiles/connections` | Profiles and social graph |
| POST / DELETE | `/api/profiles` | Create/update a username; delete account data |
| GET | `/api/stocks/quotes` | Live prices, 24h change, and volume |
| GET | `/api/portfolio` | Stock-only holdings and USDC buying power |
| GET | `/api/trades/order` | Build an executable, user-signed order |
| POST | `/api/trades/record` | Verify and record a confirmed swap |
| GET | `/api/trades/history` | Recorded on-chain trades for a wallet |
| GET | `/api/social/feed` | Position Call feed with settlement and records |
| POST | `/api/social/posts` | Publish a trade-verified Position Call |
| POST | `/api/social/follows`, `/api/social/reactions` | Follow a wallet; signal a call |

Wallet auth uses a detached ed25519 signature over a domain-bound challenge message.

## Configuration

Environment variable **names** only. Never commit real values; production secrets live
in Cloudflare Worker secret bindings.

**Backend** (`backend/.dev.vars` locally; Worker vars/secrets in production)

| Name | Kind | Purpose |
| --- | --- | --- |
| `ENVIRONMENT` | var | `development` or `production` |
| `ALLOWED_ORIGINS` | var | Comma-separated CORS allowlist |
| `DFLOW_TRADE_API_URL` | var | Quote and order endpoint |
| `SOLANA_TOKEN_RPC_URL` | secret | Token-account discovery RPC (paid) |
| `SOLANA_PROOF_RPC_URL` | secret | Transaction proof RPC (separate) |
| `DFLOW_API_KEY` | secret | Optional higher-limit key for the order provider |

**Web** (`web/.env.local`): `SOLANA_TOKEN_RPC_URL`, `DFLOW_TRADE_API_URL`, `DFLOW_API_KEY`,
`NEXT_PUBLIC_SITE_URL`, and `NEXT_PUBLIC_HEYSTOCKERS_API_URL` (production).

**Mobile** (`mobile/.env` / EAS profile env): `EXPO_PUBLIC_HEYSTOCKERS_API_URL`,
`EXPO_PUBLIC_SOLANA_RPC_URL`. Anything prefixed `EXPO_PUBLIC_` is bundled into the APK
and is public; only put public origins there, never a paid key.

## Deployment

Both web and API Workers bind the same D1 database (`heystockers`). Deploy the API first,
then the web client.

```bash
# API (deploys --env production, applies remote migrations, keeps the cron trigger)
cd backend
npm run check
npm run db:migrate:remote
npm run deploy

# Web
cd ../web
npm run lint
npm run test
npm run deploy
```

**Mobile** ships to the Solana dApp Store, not Google Play. Build a signed store APK with
EAS and submit it with its metadata:

```bash
cd mobile
npm run build:dapp-store        # eas build --profile dapp-store
```

Increment both `expo.version` and `expo.android.versionCode` for every release, and sign
every APK with the same dApp Store key.

## Security

- Paid RPC and order-provider secrets belong **only** to the API Worker, as Wrangler
  secret bindings. Never place them in the web bundle, an `EXPO_PUBLIC_*` mobile variable,
  source control, or deployment notes.
- Wallet sign-in is replay-protected and domain-bound; sessions are stored as hashes and
  expire in seven days.
- The in-memory rate limiter is a best-effort first layer. Add Cloudflare edge Rate
  Limiting rules before a public, high-volume launch.

## Testing

```bash
cd backend && npm run check     # typecheck + Vitest
cd web && npm run lint && npm run test
cd mobile && npm run ci         # typecheck + lint + format + Vitest + Android prebuild
```

The mobile suite mocks the wallet transport; the `npm run e2e` layer drives a real
emulator against a test wallet (see [`mobile/e2e/README.md`](mobile/e2e/README.md)).

## Disclaimer

HeyStockers is not a custodian, broker, or investment adviser, and provides no investment
advice. Tokenized equities are blockchain tokens, not brokerage shares, and carry market,
liquidity, issuer, smart-contract, and regulatory risk. Eligibility depends on the user's
jurisdiction. Network and market costs may apply.
