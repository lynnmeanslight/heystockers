import { Hono, type Context } from 'hono'
import { capturePriceSnapshots, getLeaderboard, getPriceHistory } from './analytics'
import { authenticatedWallet, challengeDomain, createChallenge, revokeSession, verifyChallenge } from './auth'
import { SIGNATURE_PATTERN, TRADE_ASSETS, WALLET_PATTERN } from './assets'
import { buildOrder, getStockMarket, getStockPrices } from './market'
import { positionProgress, targetMatchesSide, type PositionOutcome, type PositionSide } from './position-calls'
import { deleteAccountData, getProfileByUsername, getProfileByWallet, listConnections, profileExists, ProfileError, saveProfile, searchProfiles } from './profiles'
import { takeDurableRateLimit, takeRateLimit } from './rate-limit'
import { allowedOrigin } from './security'
import { purgeExpiredRows, settleOpenCalls } from './settlement'
import { getParsedTransaction, getPortfolio, parseSupportedTrade, transactionSignedBy, verifyTrade } from './solana'
import type { Bindings, Variables } from './types'

type AppEnv = { Bindings: Bindings; Variables: Variables }
type AppContext = Context<AppEnv>
type CallRow = {
  id: string
  wallet: string
  username: string | null
  symbol: string
  side: PositionSide
  thesis: string
  entryPrice: number
  targetPrice: number
  deadline: string
  commitmentUsdc: number
  executionSignature: string
  outcome: PositionOutcome
  resolvedAt: string | null
  resolvedPrice: number | null
  createdAt: string
  signalCount: number
  signaled: number
  following: number
}

const app = new Hono<AppEnv>()

function clientKey(c: AppContext) {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'local'
}

function limit(c: AppContext, scope: string, maximum: number, windowMs = 60_000) {
  const result = takeRateLimit(`${scope}:${clientKey(c)}`, maximum, windowMs)
  c.header('X-RateLimit-Remaining', String(result.remaining))
  if (result.allowed) return null
  c.header('Retry-After', String(result.retryAfter))
  return c.json({ error: 'Too many requests. Try again shortly.' }, 429)
}

// Shared D1-backed limit for sensitive routes; survives isolate churn.
async function limitDurable(c: AppContext, scope: string, maximum: number, windowMs = 60_000) {
  const result = await takeDurableRateLimit(c.env.DB, `${scope}:${clientKey(c)}`, maximum, windowMs)
  c.header('X-RateLimit-Remaining', String(result.remaining))
  if (result.allowed) return null
  c.header('Retry-After', String(result.retryAfter))
  return c.json({ error: 'Too many requests. Try again shortly.' }, 429)
}

async function jsonBody<T>(c: AppContext) {
  return c.req.json<T>().catch(() => ({} as T))
}

async function upstreamOrderError(upstream: Response) {
  try {
    const parsed = JSON.parse((await upstream.text()).slice(0, 500)) as { error?: unknown; msg?: unknown }
    const candidate = [parsed.error, parsed.msg].find((value) => typeof value === 'string' && value.trim())
    if (typeof candidate === 'string') return candidate.slice(0, 200)
  } catch { /* non-JSON upstream body */ }
  return 'Live execution is temporarily unavailable. No order was created.'
}

function thrownResponse(error: unknown) {
  return error instanceof Response ? error : null
}

app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  const origin = c.req.header('Origin')
  if (!allowedOrigin(origin, c.env.ALLOWED_ORIGINS)) return c.json({ error: 'Origin is not allowed.' }, 403)
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    c.header('Access-Control-Max-Age', '86400')
    c.header('Vary', 'Origin')
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  const blocked = limit(c, 'all', 180)
  if (blocked) return blocked
  await next()
})

app.get('/health', (c) => c.json({ ok: true, service: 'heystockers-api', version: '1.0.0' }))

app.get('/ready', async (c) => {
  await c.env.DB.prepare('SELECT 1 AS ready').first()
  return c.json({ ready: true })
})

app.post('/api/auth/challenge', async (c) => {
  const blocked = await limitDurable(c, 'challenge', 10)
  if (blocked) return blocked
  const body = await jsonBody<{ wallet?: string }>(c)
  try {
    const domain = challengeDomain(c.req.header('Origin'), c.env.ALLOWED_ORIGINS)
    const payload = await createChallenge(c.env.DB, body.wallet?.trim() ?? '', domain)
    c.header('Cache-Control', 'no-store')
    return c.json(payload)
  } catch (error) {
    const response = thrownResponse(error)
    if (response) return response
    throw error
  }
})

app.post('/api/auth/verify', async (c) => {
  const blocked = await limitDurable(c, 'verify', 15)
  if (blocked) return blocked
  try {
    const payload = await verifyChallenge(c.env.DB, await jsonBody(c))
    c.header('Cache-Control', 'no-store')
    return c.json(payload)
  } catch (error) {
    const response = thrownResponse(error)
    if (response) return response
    throw error
  }
})

app.post('/api/auth/logout', async (c) => {
  const revoked = await revokeSession(c.env.DB, c.req.header('Authorization'))
  c.header('Cache-Control', 'no-store')
  return c.json({ revoked })
})

app.get('/api/profiles/by-wallet', async (c) => {
  const wallet = c.req.query('wallet') ?? ''
  const viewerCandidate = c.req.query('viewer') ?? ''
  if (!WALLET_PATTERN.test(wallet)) return c.json({ error: 'Wallet address is not valid.' }, 400)
  const viewer = WALLET_PATTERN.test(viewerCandidate) ? viewerCandidate : ''
  const profile = await getProfileByWallet(c.env.DB, wallet, viewer)
  c.header('Cache-Control', 'no-store')
  return c.json({ profile })
})

app.get('/api/profiles/by-username', async (c) => {
  const blocked = limit(c, 'profile-by-username', 60)
  if (blocked) return blocked
  const viewerCandidate = c.req.query('viewer') ?? ''
  const viewer = WALLET_PATTERN.test(viewerCandidate) ? viewerCandidate : ''
  const profile = await getProfileByUsername(c.env.DB, c.req.query('username') ?? '', viewer)
  if (!profile) return c.json({ error: 'No stocker goes by that username.' }, 404)
  c.header('Cache-Control', 'no-store')
  return c.json({ profile })
})

app.get('/api/profiles/search', async (c) => {
  const blocked = limit(c, 'profile-search', 40)
  if (blocked) return blocked
  const viewerCandidate = c.req.query('viewer') ?? ''
  const viewer = WALLET_PATTERN.test(viewerCandidate) ? viewerCandidate : ''
  const profiles = await searchProfiles(c.env.DB, c.req.query('q') ?? '', viewer)
  c.header('Cache-Control', 'no-store')
  return c.json({ profiles })
})

app.get('/api/profiles/connections', async (c) => {
  const blocked = limit(c, 'connections', 40)
  if (blocked) return blocked
  const wallet = c.req.query('wallet') ?? ''
  if (!WALLET_PATTERN.test(wallet)) return c.json({ error: 'Wallet address is not valid.' }, 400)
  const viewerCandidate = c.req.query('viewer') ?? ''
  const viewer = WALLET_PATTERN.test(viewerCandidate) ? viewerCandidate : ''
  const connections = await listConnections(c.env.DB, wallet, viewer)
  c.header('Cache-Control', 'no-store')
  return c.json(connections)
})

app.post('/api/profiles', async (c) => {
  const wallet = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  if (!wallet) return c.json({ error: 'Verify your wallet before creating a username.' }, 401)
  const body = await jsonBody<{ username?: string; referralCode?: string }>(c)
  try {
    const result = await saveProfile(c.env.DB, wallet, body.username ?? '', body.referralCode ?? '')
    c.header('Cache-Control', 'no-store')
    return c.json(result, result.created ? 201 : 200)
  } catch (error) {
    if (error instanceof ProfileError) return c.json({ error: error.message }, error.status)
    throw error
  }
})

app.delete('/api/profiles', async (c) => {
  const wallet = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  if (!wallet) return c.json({ error: 'Verify your wallet before deleting your account.' }, 401)
  await deleteAccountData(c.env.DB, wallet)
  c.header('Cache-Control', 'no-store')
  return c.json({ deleted: true })
})

app.get('/api/stocks/quotes', async (c) => {
  const { prices, changes, volumes } = await getStockMarket()
  c.header('Cache-Control', 'public, max-age=10, s-maxage=15, stale-while-revalidate=30')
  return c.json({ prices, changes, volumes, updatedAt: new Date().toISOString(), source: 'Solana market activity' })
})

app.get('/api/stocks/history', async (c) => {
  const blocked = limit(c, 'stock-history', 30)
  if (blocked) return blocked
  const series = await getPriceHistory(c.env.DB)
  c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  return c.json({ series, windowHours: 24 })
})

app.get('/api/social/leaderboard', async (c) => {
  const blocked = limit(c, 'leaderboard', 30)
  if (blocked) return blocked
  const leaders = await getLeaderboard(c.env.DB, 25)
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  return c.json({ leaders })
})

app.get('/api/portfolio', async (c) => {
  const wallet = c.req.query('wallet') ?? ''
  if (!WALLET_PATTERN.test(wallet)) return c.json({ error: 'Wallet address is not valid.' }, 400)
  const fresh = c.req.query('fresh') === '1'
  if (fresh) {
    const blocked = await limitDurable(c, 'portfolio-fresh', 10)
    if (blocked) return blocked
  }
  try {
    const result = await getPortfolio(c.env, wallet, { fresh })
    c.header('Cache-Control', 'private, no-store')
    c.header('X-HeyStockers-Cache', result.cache)
    return c.json(result.payload)
  } catch (error) {
    console.error(JSON.stringify({ requestId: c.get('requestId'), operation: 'portfolio', message: error instanceof Error ? error.message : 'unknown' }))
    return c.json({ error: 'The stock wallet could not be read.' }, 502)
  }
})

app.get('/api/trades/order', async (c) => {
  const blocked = await limitDurable(c, 'order', 30)
  if (blocked) return blocked
  const userPublicKey = c.req.query('userPublicKey') ?? ''
  if (userPublicKey && !WALLET_PATTERN.test(userPublicKey)) return c.json({ error: 'Wallet address is not valid.' }, 400)
  try {
    const upstream = await buildOrder(c.env, {
      inputMint: c.req.query('inputMint') ?? '',
      outputMint: c.req.query('outputMint') ?? '',
      amount: c.req.query('amount') ?? '',
      userPublicKey,
    })
    const headers = new Headers(c.res.headers)
    headers.set('Cache-Control', 'no-store')
    if (!upstream.ok) {
      // Surface only a short vetted message instead of the raw upstream body.
      headers.set('Content-Type', 'application/json')
      return new Response(JSON.stringify({ error: await upstreamOrderError(upstream) }), { status: upstream.status, headers })
    }
    headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  } catch (error) {
    const response = thrownResponse(error)
    if (response) return response
    console.error(JSON.stringify({ requestId: c.get('requestId'), operation: 'order', message: error instanceof Error ? error.message : 'unknown' }))
    return c.json({ error: 'Live execution is temporarily unavailable. No order was created.' }, 502)
  }
})

app.post('/api/trades/record', async (c) => {
  const blocked = await limitDurable(c, 'trade-record', 12)
  if (blocked) return blocked
  const body = await jsonBody<{ signature?: string; wallet?: string }>(c)
  const signature = body.signature?.trim() ?? ''
  const wallet = body.wallet?.trim() ?? ''
  if (!WALLET_PATTERN.test(wallet) || !SIGNATURE_PATTERN.test(signature)) {
    return c.json({ error: 'A wallet and confirmed trade signature are required.' }, 400)
  }
  const existing = await c.env.DB.prepare('SELECT signature FROM trades WHERE signature = ?').bind(signature).first()
  if (existing) return c.json({ recorded: true, duplicate: true })
  try {
    const transaction = await getParsedTransaction(c.env, signature)
    if (!transaction || !transactionSignedBy(transaction, wallet)) {
      return c.json({ error: 'This trade is not confirmed for that wallet yet.' }, 409)
    }
    const trade = parseSupportedTrade(transaction, wallet)
    if (!trade) return c.json({ error: 'Only supported stock and USDC swaps are recorded.' }, 422)
    const blockTime = transaction.blockTime ? new Date(transaction.blockTime * 1000).toISOString() : null
    if (!blockTime || Date.parse(blockTime) < Date.now() - 24 * 60 * 60_000) {
      return c.json({ error: 'Only recent trades can be recorded.' }, 422)
    }
    await c.env.DB.prepare(
      `INSERT INTO trades (signature, wallet, symbol, side, asset_atomic, usdc_atomic, price_usd, block_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(signature) DO NOTHING`,
    ).bind(signature, wallet, trade.symbol, trade.side, trade.assetAtomic, trade.usdcAtomic, trade.priceUsd, blockTime, new Date().toISOString()).run()
    return c.json({ recorded: true, trade: { ...trade, signature, blockTime } }, 201)
  } catch (error) {
    console.error(JSON.stringify({ requestId: c.get('requestId'), operation: 'trade-record', message: error instanceof Error ? error.message : 'unknown' }))
    return c.json({ error: 'The trade could not be verified right now.' }, 502)
  }
})

app.get('/api/trades/history', async (c) => {
  const blocked = limit(c, 'trade-history', 60)
  if (blocked) return blocked
  const wallet = c.req.query('wallet') ?? ''
  if (!WALLET_PATTERN.test(wallet)) return c.json({ error: 'Wallet address is not valid.' }, 400)
  const result = await c.env.DB.prepare(
    `SELECT signature, symbol, side, asset_atomic AS assetAtomic, usdc_atomic AS usdcAtomic,
       price_usd AS priceUsd, block_time AS blockTime
     FROM trades WHERE wallet = ? ORDER BY block_time DESC LIMIT 50`,
  ).bind(wallet).all()
  c.header('Cache-Control', 'no-store')
  return c.json({ trades: result.results })
})

app.get('/api/social/feed', async (c) => {
  const blocked = limit(c, 'feed', 60)
  if (blocked) return blocked
  const candidate = c.req.query('viewer') ?? ''
  const viewer = WALLET_PATTERN.test(candidate) ? candidate : ''
  const authorCandidate = c.req.query('author') ?? ''
  const author = WALLET_PATTERN.test(authorCandidate) ? authorCandidate : ''
  const beforeCandidate = c.req.query('before') ?? ''
  const before = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(beforeCandidate) ? beforeCandidate : ''
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query('limit')) || 30))
  const [callResult, prices] = await Promise.all([
    c.env.DB.prepare(
      `SELECT c.id, c.wallet, p.username, c.symbol, c.side, c.thesis,
        c.entry_price AS entryPrice, c.target_price AS targetPrice,
        c.deadline, c.commitment_usdc AS commitmentUsdc,
        c.execution_signature AS executionSignature, c.outcome,
        c.resolved_at AS resolvedAt, c.resolved_price AS resolvedPrice,
        c.created_at AS createdAt,
        (SELECT COUNT(*) FROM call_signals s WHERE s.call_id = c.id) AS signalCount,
        EXISTS(SELECT 1 FROM call_signals vs WHERE vs.call_id = c.id AND vs.wallet = ?1) AS signaled,
        EXISTS(SELECT 1 FROM follows f WHERE f.follower_wallet = ?2 AND f.following_wallet = c.wallet) AS following
      FROM position_calls c
      LEFT JOIN profiles p ON p.wallet = c.wallet
      WHERE (?3 = '' OR c.created_at < ?3) AND (?4 = '' OR c.wallet = ?4)
      ORDER BY c.created_at DESC LIMIT ?5`,
    ).bind(viewer, viewer, before, author, pageSize).all<CallRow>(),
    getStockPrices(c.env),
  ])
  // Read-only: the cron in settlement.ts is the settlement authority, so the
  // feed reports stored outcomes plus live progress toward the target.
  const calls = callResult.results.map((call) => ({
    ...call,
    currentPrice: prices[call.symbol] ?? null,
    progress: positionProgress(call.side, call.entryPrice, call.targetPrice, prices[call.symbol] ?? null),
    signaled: Boolean(call.signaled),
    following: Boolean(call.following),
  }))
  const wallets = [...new Set(calls.map((call) => call.wallet))]
  const byWallet: Record<string, { wins: number; losses: number }> = {}
  if (wallets.length) {
    const records = await c.env.DB.prepare(
      `SELECT wallet,
        SUM(CASE WHEN outcome = 'WON' THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN outcome = 'LOST' THEN 1 ELSE 0 END) AS losses
      FROM position_calls WHERE wallet IN (${wallets.map(() => '?').join(',')}) GROUP BY wallet`,
    ).bind(...wallets).all<{ wallet: string; wins: number; losses: number }>()
    for (const record of records.results) byWallet[record.wallet] = { wins: record.wins, losses: record.losses }
  }
  c.header('Cache-Control', 'no-store')
  return c.json({
    calls: calls.map((call) => ({ ...call, record: byWallet[call.wallet] ?? { wins: 0, losses: 0 } })),
    nextBefore: callResult.results.length === pageSize ? callResult.results[callResult.results.length - 1]?.createdAt ?? null : null,
  })
})

app.post('/api/social/posts', async (c) => {
  const blocked = await limitDurable(c, 'posts', 10)
  if (blocked) return blocked
  const wallet = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  if (!wallet) return c.json({ error: 'Verify your wallet before publishing a call.' }, 401)
  if (!(await profileExists(c.env.DB, wallet))) return c.json({ error: 'Create your username before publishing a call.' }, 409)
  const body = await jsonBody<{ symbol?: string; side?: PositionSide; targetPrice?: number; deadline?: string; commitmentUsdc?: number; thesis?: string; signature?: string }>(c)
  const symbol = body.symbol ?? ''
  const side = body.side ?? 'BUY'
  const targetPrice = Number(body.targetPrice)
  const commitmentUsdc = Number(body.commitmentUsdc)
  const thesis = body.thesis?.trim() ?? ''
  const signature = body.signature?.trim() ?? ''
  const deadline = new Date(body.deadline ?? '')
  const now = Date.now()
  const asset = TRADE_ASSETS.find((candidate) => candidate.symbol === symbol)
  if (!asset || !['BUY', 'SELL'].includes(side)) return c.json({ error: 'Choose Buy or Sell on a supported stock.' }, 400)
  if (!SIGNATURE_PATTERN.test(signature)) return c.json({ error: 'Complete the matching wallet trade before publishing.' }, 400)
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) return c.json({ error: 'Enter a valid target price.' }, 400)
  if (!Number.isFinite(commitmentUsdc) || commitmentUsdc < 1 || commitmentUsdc > 25) return c.json({ error: 'Commit between $1 and $25.' }, 400)
  if (thesis.length < 10 || thesis.length > 280) return c.json({ error: 'Explain the call in 10–280 characters.' }, 400)
  if (!Number.isFinite(deadline.getTime()) || deadline.getTime() < now + 60 * 60_000 || deadline.getTime() > now + 31 * 24 * 60 * 60_000) {
    return c.json({ error: 'Choose a deadline between 1 hour and 31 days.' }, 400)
  }
  const used = await c.env.DB.prepare('SELECT id FROM position_calls WHERE execution_signature = ?').bind(signature).first()
  if (used) return c.json({ error: 'This trade already backs a position call.' }, 409)
  const entryPrice = (await getStockPrices(c.env))[symbol] ?? null
  if (entryPrice === null) return c.json({ error: 'A live entry price is required. Try again shortly.' }, 503)
  if (!targetMatchesSide(side, entryPrice, targetPrice)) {
    return c.json({ error: side === 'BUY' ? 'A Buy target must be above the entry price.' : 'A Sell target must be below the entry price.' }, 400)
  }
  const proof = await verifyTrade(c.env, signature, wallet, { assetMint: asset.mint, side, commitmentUsdc })
  const tradeTime = proof.blockTime === null ? null : proof.blockTime * 1000
  if (!proof.valid || tradeTime === null || tradeTime < now - 15 * 60_000 || tradeTime > now + 60_000) {
    return c.json({ error: 'The confirmed trade must match this stock, direction, and commitment.' }, 409)
  }
  const call = { id: crypto.randomUUID(), wallet, symbol, side, thesis, entryPrice, targetPrice, deadline: deadline.toISOString(), commitmentUsdc, signature, createdAt: new Date(now).toISOString() }
  try {
    await c.env.DB.prepare(
      `INSERT INTO position_calls (id, wallet, symbol, side, thesis, entry_price, target_price, deadline, commitment_usdc, execution_signature, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(call.id, wallet, symbol, side, thesis, entryPrice, targetPrice, call.deadline, commitmentUsdc, signature, call.createdAt).run()
  } catch {
    return c.json({ error: 'This trade already backs a position call.' }, 409)
  }
  return c.json({ call }, 201)
})

app.post('/api/social/follows', async (c) => {
  const follower = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  if (!follower) return c.json({ error: 'Verify your wallet before following.' }, 401)
  if (!(await profileExists(c.env.DB, follower))) return c.json({ error: 'Create your username before following.' }, 409)
  const following = (await jsonBody<{ wallet?: string }>(c)).wallet?.trim() ?? ''
  if (!WALLET_PATTERN.test(following) || following === follower) return c.json({ error: 'Choose another verified wallet.' }, 400)
  const target = await c.env.DB.prepare('SELECT wallet FROM profiles WHERE wallet = ?').bind(following).first()
  if (!target) return c.json({ error: 'This wallet has not joined HeyStockers.' }, 404)
  const existing = await c.env.DB.prepare('SELECT 1 AS found FROM follows WHERE follower_wallet = ? AND following_wallet = ?').bind(follower, following).first()
  if (existing) {
    await c.env.DB.prepare('DELETE FROM follows WHERE follower_wallet = ? AND following_wallet = ?').bind(follower, following).run()
    return c.json({ following: false })
  }
  await c.env.DB.prepare('INSERT INTO follows (follower_wallet, following_wallet, created_at) VALUES (?, ?, ?)').bind(follower, following, new Date().toISOString()).run()
  return c.json({ following: true })
})

app.post('/api/social/reactions', async (c) => {
  const wallet = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  if (!wallet) return c.json({ error: 'Verify your wallet before signaling.' }, 401)
  if (!(await profileExists(c.env.DB, wallet))) return c.json({ error: 'Create your username before signaling.' }, 409)
  const callId = (await jsonBody<{ callId?: string }>(c)).callId?.trim() ?? ''
  if (!callId) return c.json({ error: 'Call id is required.' }, 400)
  const call = await c.env.DB.prepare('SELECT id FROM position_calls WHERE id = ?').bind(callId).first()
  if (!call) return c.json({ error: 'Position call not found.' }, 404)
  const existing = await c.env.DB.prepare('SELECT 1 AS found FROM call_signals WHERE call_id = ? AND wallet = ?').bind(callId, wallet).first()
  if (existing) {
    await c.env.DB.prepare('DELETE FROM call_signals WHERE call_id = ? AND wallet = ?').bind(callId, wallet).run()
    return c.json({ reacted: false })
  }
  await c.env.DB.prepare('INSERT INTO call_signals (call_id, wallet, created_at) VALUES (?, ?, ?)').bind(callId, wallet, new Date().toISOString()).run()
  return c.json({ reacted: true })
})

app.notFound((c) => c.json({ error: 'Not found.' }, 404))
app.onError((error, c) => {
  console.error(JSON.stringify({ requestId: c.get('requestId'), operation: 'request', message: error.message }))
  return c.json({ error: 'The service could not complete this request.', requestId: c.get('requestId') }, 500)
})

async function runScheduledMaintenance(env: Bindings) {
  try {
    const settled = await settleOpenCalls(env.DB)
    await capturePriceSnapshots(env.DB)
    await purgeExpiredRows(env.DB)
    if (settled) console.log(JSON.stringify({ operation: 'settlement', settled }))
  } catch (error) {
    console.error(JSON.stringify({ operation: 'settlement', message: error instanceof Error ? error.message : 'unknown' }))
  }
}

export { app }

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledMaintenance(env))
  },
}
