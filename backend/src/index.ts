import { Hono, type Context } from 'hono'
import { authenticatedWallet, createChallenge, verifyChallenge } from './auth'
import { SIGNATURE_PATTERN, TRADE_ASSETS, WALLET_PATTERN } from './assets'
import { buildOrder, getStockMarket, getStockPrices } from './market'
import { positionProgress, settlePositionCall, targetMatchesSide, type PositionOutcome, type PositionSide } from './position-calls'
import { deleteAccountData, getProfileByWallet, profileExists, ProfileError, saveProfile, searchProfiles } from './profiles'
import { takeRateLimit } from './rate-limit'
import { allowedOrigin } from './security'
import { getPortfolio, verifyTrade } from './solana'
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

async function jsonBody<T>(c: AppContext) {
  return c.req.json<T>().catch(() => ({} as T))
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
  const blocked = limit(c, 'challenge', 10)
  if (blocked) return blocked
  const body = await jsonBody<{ wallet?: string }>(c)
  try {
    const payload = await createChallenge(c.env.DB, body.wallet?.trim() ?? '')
    c.header('Cache-Control', 'no-store')
    return c.json(payload)
  } catch (error) {
    const response = thrownResponse(error)
    if (response) return response
    throw error
  }
})

app.post('/api/auth/verify', async (c) => {
  const blocked = limit(c, 'verify', 15)
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

app.get('/api/profiles/by-wallet', async (c) => {
  const wallet = c.req.query('wallet') ?? ''
  const viewerCandidate = c.req.query('viewer') ?? ''
  if (!WALLET_PATTERN.test(wallet)) return c.json({ error: 'Wallet address is not valid.' }, 400)
  const viewer = WALLET_PATTERN.test(viewerCandidate) ? viewerCandidate : ''
  const profile = await getProfileByWallet(c.env.DB, wallet, viewer)
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
  const { prices, volumes } = await getStockMarket()
  c.header('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120')
  return c.json({ prices, volumes, updatedAt: new Date().toISOString(), source: 'Solana market activity' })
})

app.get('/api/portfolio', async (c) => {
  const wallet = c.req.query('wallet') ?? ''
  if (!WALLET_PATTERN.test(wallet)) return c.json({ error: 'Wallet address is not valid.' }, 400)
  try {
    const result = await getPortfolio(c.env, wallet)
    c.header('Cache-Control', 'private, no-store')
    c.header('X-HeyStockers-Cache', result.cache)
    return c.json(result.payload)
  } catch (error) {
    console.error(JSON.stringify({ requestId: c.get('requestId'), operation: 'portfolio', message: error instanceof Error ? error.message : 'unknown' }))
    return c.json({ error: 'The stock wallet could not be read.' }, 502)
  }
})

app.get('/api/trades/order', async (c) => {
  const blocked = limit(c, 'order', 30)
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
    headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')
    headers.set('Cache-Control', 'no-store')
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

app.get('/api/social/feed', async (c) => {
  const candidate = c.req.query('viewer') ?? ''
  const viewer = WALLET_PATTERN.test(candidate) ? candidate : ''
  const [callResult, prices] = await Promise.all([
    c.env.DB.prepare(
      `SELECT c.id, c.wallet, p.username, c.symbol, c.side, c.thesis,
        c.entry_price AS entryPrice, c.target_price AS targetPrice,
        c.deadline, c.commitment_usdc AS commitmentUsdc,
        c.execution_signature AS executionSignature, c.outcome,
        c.resolved_at AS resolvedAt, c.resolved_price AS resolvedPrice,
        c.created_at AS createdAt,
        (SELECT COUNT(*) FROM call_signals s WHERE s.call_id = c.id) AS signalCount,
        EXISTS(SELECT 1 FROM call_signals vs WHERE vs.call_id = c.id AND vs.wallet = ?) AS signaled,
        EXISTS(SELECT 1 FROM follows f WHERE f.follower_wallet = ? AND f.following_wallet = c.wallet) AS following
      FROM position_calls c
      LEFT JOIN profiles p ON p.wallet = c.wallet
      ORDER BY c.created_at DESC LIMIT 100`,
    ).bind(viewer, viewer).all<CallRow>(),
    getStockPrices(c.env),
  ])
  const now = new Date()
  const calls = callResult.results.map((call) => {
    const currentPrice = prices[call.symbol] ?? null
    const outcome = call.outcome === 'OPEN' ? settlePositionCall(call.side, call.targetPrice, call.deadline, currentPrice, now.getTime()) : call.outcome
    return { ...call, currentPrice, outcome, progress: positionProgress(call.side, call.entryPrice, call.targetPrice, currentPrice), signaled: Boolean(call.signaled), following: Boolean(call.following) }
  })
  const settled = calls.filter((call, index) => callResult.results[index]?.outcome === 'OPEN' && call.outcome !== 'OPEN' && call.currentPrice !== null)
  if (settled.length) {
    await c.env.DB.batch(settled.map((call) => c.env.DB.prepare(
      "UPDATE position_calls SET outcome = ?, resolved_at = ?, resolved_price = ? WHERE id = ? AND outcome = 'OPEN'",
    ).bind(call.outcome, now.toISOString(), call.currentPrice, call.id)))
  }
  const records = await c.env.DB.prepare(
    `SELECT wallet,
      SUM(CASE WHEN outcome = 'WON' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN outcome = 'LOST' THEN 1 ELSE 0 END) AS losses
    FROM position_calls GROUP BY wallet`,
  ).all<{ wallet: string; wins: number; losses: number }>()
  const byWallet = Object.fromEntries(records.results.map((record) => [record.wallet, { wins: record.wins, losses: record.losses }]))
  c.header('Cache-Control', 'no-store')
  return c.json({ calls: calls.map((call) => ({ ...call, record: byWallet[call.wallet] ?? { wins: 0, losses: 0 } })) })
})

app.post('/api/social/posts', async (c) => {
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

export default app
