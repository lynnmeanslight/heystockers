# HeyStockers backend

Standalone Cloudflare Worker API for the HeyStockers web and Solana Mobile clients.

## What it owns

- Wallet challenge authentication and seven-day sessions
- Cached stock quotes and executable order construction
- Cached token-account portfolio reads
- On-chain trade-proof verification and signature replay protection
- Position Calls, records, signals, and follows in D1
- CORS, request IDs, security headers, and best-effort edge rate limiting

The paid token-account RPC is used only for two `getTokenAccountsByOwner` calls on an uncached portfolio read. Trade proof uses the separate `SOLANA_PROOF_RPC_URL`.

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

The Worker starts on `http://localhost:8787`. Check `GET /health` and `GET /ready`.

## MagicBlock compatibility probe

Run the read-only mainnet quote matrix without building, signing, or submitting transactions:

```bash
npm run probe:magicblock
```

Set `MAGICBLOCK_API_URL` to test another compatible endpoint. The command checks every supported USDC/xStock pair in both directions and exits unsuccessfully when no asset works in both directions. It does not change the production DFlow order route.

As of September 1, 2026, `https://payments.magicblock.app/health` returns 200, but the documented `GET /v1/swap/quote` returns HTTP 405 with a Solana JSON-RPC `Bad method` response and an `x-rpc-node` header. This indicates an upstream routing mismatch. MagicBlock trading must remain disabled until the documented REST quote endpoint returns valid quotes and the full matrix is rerun.

## Production setup

Production is a named Wrangler environment (`env.production` in `wrangler.jsonc`). Top-level config is local dev only. Every production command below carries `--env production`.

1. Create or select the production D1 database. To preserve existing social data, bind this Worker to the same production D1 database currently used by the web API. Do not silently create an empty replacement.
2. Replace the `REPLACE_WITH_PROD_D1_ID` sentinel under `env.production.d1_databases` in `wrangler.jsonc` with the real database id.
3. `ALLOWED_ORIGINS` and the `api.heystockers.trade` custom domain are already set under `env.production`. Confirm they match the final web origin.
4. Store secrets with Wrangler in the production environment; never place them in the mobile environment:

```bash
npx wrangler secret put SOLANA_TOKEN_RPC_URL --env production
npx wrangler secret put SOLANA_PROOF_RPC_URL --env production
npx wrangler secret put DFLOW_API_KEY --env production
```

5. Apply migrations, validate, and deploy (all target `env.production` via the npm scripts):

```bash
npm run db:migrate:remote
npm run check
npm run deploy
```

6. Point clients at the deployed HTTPS origin:

```bash
EXPO_PUBLIC_HEYSTOCKERS_API_URL=https://api.your-domain.example
```

## Compatibility and rollback

This is the expand stage of the backend extraction. The existing `/web/app/api` routes remain operational and use the same request/response contract. After deployment, switch one client at a time to the Worker and verify wallet auth, portfolio, orders, trade proof, and feed behavior.

Rollback is configuration-only: point the affected client back to the existing web origin. Do not remove the web API routes until the standalone backend has completed a production observation window.

The in-memory rate limiter is an inexpensive first layer, not a global distributed quota. Add Cloudflare Rate Limiting rules before a public high-volume launch.
