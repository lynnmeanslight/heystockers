export const API_BASE_URL = (process.env.EXPO_PUBLIC_HEYSTOCKERS_API_URL ?? 'https://api.heystockers.trade').replace(
  /\/$/,
  '',
)

export type Holding = {
  symbol: string
  name: string
  amount: number
  priceUsd: number | null
  valueUsd: number | null
}

export type Portfolio = {
  wallet: string
  stockValueUsd: number
  usdcValueUsd: number
  holdings: Holding[]
  prices: Record<string, number | null>
  updatedAt: string
}

export type PositionCall = {
  id: string
  wallet: string
  username: string | null
  symbol: string
  side: 'BUY' | 'SELL'
  thesis: string
  entryPrice: number
  targetPrice: number
  currentPrice: number | null
  deadline: string
  commitmentUsdc: number
  executionSignature: string | null
  outcome: 'OPEN' | 'WON' | 'LOST'
  progress: number
  createdAt: string
  signalCount: number
  signaled: boolean
  following: boolean
  record: { wins: number; losses: number }
}

export type UserProfile = {
  wallet: string
  username: string
  referralCode: string
  referralCount: number
  followerCount: number
  followingCount: number
  wins: number
  losses: number
  following: boolean
}

export type Order = {
  transaction?: string
  contextSlot?: number | string
  outAmount?: string
  priceImpactPct?: string
  error?: string
  msg?: string
}

type ApiErrorBody = { error?: string; msg?: string }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const body = (await response.json().catch(() => ({}))) as T & ApiErrorBody
  if (!response.ok)
    throw new ApiError(body.error ?? body.msg ?? `Request failed (${response.status}).`, response.status)
  return body
}

export function getQuotes() {
  return request<{ prices: Record<string, number | null>; volumes: Record<string, number>; updatedAt: string }>(
    '/api/stocks/quotes',
  )
}

export function getPortfolio(wallet: string) {
  return request<Portfolio>(`/api/portfolio?wallet=${encodeURIComponent(wallet)}`)
}

export function getFeed(viewer = '') {
  const query = viewer ? `?viewer=${encodeURIComponent(viewer)}` : ''
  return request<{ calls: PositionCall[] }>(`/api/social/feed${query}`)
}

export async function getProfile(wallet: string, viewer = '') {
  const query = new URLSearchParams({ wallet, ...(viewer ? { viewer } : {}) }).toString()
  return (await request<{ profile: UserProfile | null }>(`/api/profiles/by-wallet?${query}`)).profile
}

export async function searchProfiles(query: string, viewer = '') {
  const params = new URLSearchParams({ q: query, ...(viewer ? { viewer } : {}) }).toString()
  return (await request<{ profiles: UserProfile[] }>(`/api/profiles/search?${params}`)).profiles
}

export function getOrder(params: { inputMint: string; outputMint: string; amount: string; userPublicKey: string }) {
  const query = new URLSearchParams(params).toString()
  return request<Order>(`/api/trades/order?${query}`)
}

export function createChallenge(wallet: string) {
  return request<{ challengeId: string; message: string; expiresAt: string }>('/api/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ wallet }),
  })
}

export function verifyChallenge(wallet: string, challengeId: string, signature: string) {
  return request<{ token: string; expiresAt: string }>('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ wallet, challengeId, signature }),
  })
}

export type NewCall = {
  symbol: string
  side: 'BUY' | 'SELL'
  targetPrice: number
  deadline: string
  commitmentUsdc: number
  thesis: string
}

function authenticatedRequest<T>(path: string, token: string, body: object, method = 'POST') {
  return request<T>(path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

export function createPositionCall(token: string, call: NewCall, signature: string) {
  return authenticatedRequest<{ call: { id: string } }>('/api/social/posts', token, { ...call, signature })
}

export function saveProfile(token: string, username: string, referralCode = '') {
  return authenticatedRequest<{
    profile: UserProfile
    created: boolean
    referralStatus: 'applied' | 'invalid' | 'none'
  }>('/api/profiles', token, { username, referralCode })
}

export function deleteProfile(token: string) {
  return request<{ deleted: true }>('/api/profiles', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function toggleSignal(token: string, callId: string) {
  return authenticatedRequest<{ reacted: boolean }>('/api/social/reactions', token, { callId })
}

export function toggleFollow(token: string, wallet: string) {
  return authenticatedRequest<{ following: boolean }>('/api/social/follows', token, { wallet })
}
