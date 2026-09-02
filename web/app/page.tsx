'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { CommunityModal, type UserProfile } from '../components/CommunityModal';
import { OnboardingGuide } from '../components/OnboardingGuide';
import { PeopleSearch } from '../components/PeopleSearch';
import { TradeModal } from '../components/TradeModal';
import { apiUrl } from '../lib/api';
import { TRADE_ASSETS } from '../lib/assets';
import { connectWalletProvider, getWalletProvider, isMobileUserAgent, phantomBrowseUrl } from '../lib/wallet';

type Holding = { symbol: string; name: string; amount: number; priceUsd: number | null; valueUsd: number | null };
type PortfolioResponse = { wallet: string; stockValueUsd: number; usdcValueUsd: number; holdings: Holding[]; prices: Record<string, number | null>; updatedAt: string; source: string; error?: string };
type PositionCall = { id: string; wallet: string; username: string | null; symbol: string; side: 'BUY' | 'SELL'; thesis: string; entryPrice: number; targetPrice: number; currentPrice: number | null; deadline: string; commitmentUsdc: number; executionSignature: string | null; outcome: 'OPEN' | 'WON' | 'LOST'; progress: number; createdAt: string; resolvedAt: string | null; resolvedPrice: number | null; signalCount: number; signaled: boolean; following: boolean; record: { wins: number; losses: number } };
type CallDraft = { symbol: string; side: 'BUY' | 'SELL'; targetPrice: number; deadline: string; commitmentUsdc: number; thesis: string };
type PendingTradeProof = { call: CallDraft; signature: string };
type StoredSession = { token: string; wallet: string; expiresAt: string };
type TradeRecord = { signature: string; symbol: string; side: 'BUY' | 'SELL'; assetAtomic: string; usdcAtomic: string; priceUsd: number | null; blockTime: string | null };

const SESSION_KEY = 'heystockers:session';
const TAB_KEY = 'heystockers:tab';
const MAIN_TABS = ['feed', 'market', 'portfolio'] as const;
type MainTab = (typeof MAIN_TABS)[number];

function readStoredSession(wallet: string): StoredSession | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? 'null') as StoredSession | null;
    if (!stored?.token || stored.wallet !== wallet) return null;
    // A minute of headroom so a token never expires mid-request.
    if (new Date(stored.expiresAt).getTime() <= Date.now() + 60_000) return null;
    return stored;
  } catch {
    return null;
  }
}

function storeSession(session: StoredSession) {
  try { window.localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* storage unavailable */ }
}

function clearStoredSession() {
  try { window.localStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ }
}

function shortenAddress(address: string) { return address ? `${address.slice(0, 4)}…${address.slice(-4)}` : 'Not connected'; }
function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}
function formatVolume(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
function formatSignedUsd(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', signDisplay: 'exceptZero', maximumFractionDigits: 2 }).format(Math.abs(value) < 0.005 ? 0 : value);
}
// Staked P&L per call: the USDC commitment moved by the price change from
// entry to the live price (open) or the settlement price (resolved).
function callPnl(call: PositionCall) {
  const price = call.outcome === 'OPEN' ? call.currentPrice : call.resolvedPrice ?? call.currentPrice;
  if (price === null || call.entryPrice <= 0) return null;
  const move = call.side === 'BUY' ? price / call.entryPrice - 1 : (call.entryPrice - price) / call.entryPrice;
  return call.commitmentUsdc * move;
}
function timeAgo(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
function shortDate(value: string) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)); }

export default function Home() {
  const [walletAddress, setWalletAddress] = useState('');
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [marketPrices, setMarketPrices] = useState<Record<string, number | null>>({});
  const [marketVolumes, setMarketVolumes] = useState<Record<string, number>>({});
  const [marketChanges, setMarketChanges] = useState<Record<string, number | null>>({});
  const [priceFlash, setPriceFlash] = useState<Record<string, 'up' | 'down'>>({});
  const lastPricesRef = useRef<Record<string, number | null>>({});
  const [calls, setCalls] = useState<PositionCall[]>([]);
  const [feedStatus, setFeedStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const paginatedRef = useRef(false);
  const [portfolioStatus, setPortfolioStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [authToken, setAuthToken] = useState('');
  const [authStatus, setAuthStatus] = useState<'idle' | 'signing' | 'ready'>('idle');
  const [symbol, setSymbol] = useState('NVDAx');
  const [callSide, setCallSide] = useState<'BUY' | 'SELL'>('BUY');
  const [targetPrice, setTargetPrice] = useState('');
  const [deadlineDays, setDeadlineDays] = useState(7);
  const [commitmentUsdc, setCommitmentUsdc] = useState(10);
  const [thesis, setThesis] = useState('');
  const [posting, setPosting] = useState(false);
  const [toast, setToast] = useState('');
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeAsset, setTradeAsset] = useState('NVDAx');
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [tradeAmount, setTradeAmount] = useState<number | undefined>();
  const [callDraft, setCallDraft] = useState<CallDraft | null>(null);
  const [pendingTradeProof, setPendingTradeProof] = useState<PendingTradeProof | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'market' | 'portfolio' | 'feed'>('market');
  const [portfolioView, setPortfolioView] = useState<'holdings' | 'history'>('holdings');
  const [referralCode] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('ref')?.trim() ?? '');

  const loadFeed = useCallback(async (viewer = '', options: { before?: string; append?: boolean } = {}) => {
    try {
      const params = new URLSearchParams();
      if (viewer) params.set('viewer', viewer);
      if (options.before) params.set('before', options.before);
      const query = params.toString();
      const response = await fetch(apiUrl(`/api/social/feed${query ? `?${query}` : ''}`), { cache: 'no-store' });
      const payload = await response.json() as { calls?: PositionCall[]; nextBefore?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Feed unavailable');
      const page = payload.calls ?? [];
      setCalls((current) => options.append
        ? [...current, ...page.filter((call) => !current.some((existing) => existing.id === call.id))]
        // Refresh keeps already-paginated older calls below the fresh first page.
        : [...page, ...current.filter((call) => !page.some((fresh) => fresh.id === call.id))]);
      if (options.append) {
        paginatedRef.current = true;
        setNextBefore(payload.nextBefore ?? null);
      } else if (!paginatedRef.current) {
        setNextBefore(payload.nextBefore ?? null);
      }
      setFeedStatus('ready');
    } catch {
      if (!options.append) setCalls([]);
      setFeedStatus('error');
    }
  }, []);

  const loadPortfolio = useCallback(async (address: string, fresh = false) => {
    // Background refreshes keep the last good snapshot on screen.
    setPortfolioStatus((current) => current === 'ready' ? 'ready' : 'loading');
    try {
      const params = new URLSearchParams({ wallet: address });
      if (fresh) params.set('fresh', '1');
      const response = await fetch(apiUrl(`/api/portfolio?${params.toString()}`), { cache: 'no-store' });
      const payload = await response.json() as PortfolioResponse;
      if (!response.ok) throw new Error(payload.error ?? 'Wallet read failed');
      setPortfolio(payload);
      setPortfolioStatus('ready');
    } catch {
      setPortfolioStatus((current) => current === 'ready' ? 'ready' : 'error');
    }
  }, []);

  const loadTradeHistory = useCallback(async (address: string) => {
    if (!address) { setTradeHistory([]); return; }
    try {
      const response = await fetch(apiUrl(`/api/trades/history?wallet=${encodeURIComponent(address)}`), { cache: 'no-store' });
      const payload = await response.json() as { trades?: TradeRecord[] };
      if (response.ok) setTradeHistory(payload.trades ?? []);
    } catch { /* keep the last known history */ }
  }, []);

  const loadProfile = useCallback(async (address: string) => {
    try {
      const response = await fetch(apiUrl(`/api/profiles/by-wallet?wallet=${encodeURIComponent(address)}&viewer=${encodeURIComponent(address)}`), { cache: 'no-store' });
      const payload = await response.json() as { profile?: UserProfile | null };
      setProfile(response.ok ? payload.profile ?? null : null);
      return response.ok ? payload.profile ?? null : null;
    } catch {
      setProfile(null);
      return null;
    }
  }, []);

  const loadQuotes = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/stocks/quotes'), { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json() as { prices?: Record<string, number | null>; changes?: Record<string, number | null>; volumes?: Record<string, number> };
      const prices = payload.prices ?? {};
      // Flash each price green/red for one tick when it moves vs. the previous poll.
      const previous = lastPricesRef.current;
      const flash: Record<string, 'up' | 'down'> = {};
      for (const [asset, value] of Object.entries(prices)) {
        const prior = previous[asset];
        if (value !== null && value !== undefined && prior !== null && prior !== undefined && value !== prior) {
          flash[asset] = value > prior ? 'up' : 'down';
        }
      }
      lastPricesRef.current = prices;
      setMarketPrices(prices);
      setMarketVolumes(payload.volumes ?? {});
      setMarketChanges(payload.changes ?? {});
      setPriceFlash(flash);
      const initialPrice = prices.NVDAx ?? null;
      if (initialPrice !== null) setTargetPrice((current) => current || (initialPrice * 1.05).toFixed(2));
    } catch {
      // Keep the last good quotes if a refresh fails.
    }
  }, []);

  const applyAddress = useCallback((address: string) => {
    setWalletAddress(address);
    const restored = address ? readStoredSession(address) : null;
    setAuthToken(restored?.token ?? '');
    setAuthStatus(restored ? 'ready' : 'idle');
    if (address) {
      setPortfolio(null);
      setPortfolioStatus('loading');
      void loadPortfolio(address);
      void loadFeed(address);
      void loadTradeHistory(address);
      void loadProfile(address).then((loaded) => { if (!loaded) setCommunityOpen(true); });
    } else {
      setPortfolio(null);
      setProfile(null);
      setPortfolioStatus('idle');
      setTradeHistory([]);
      void loadFeed('');
    }
  }, [loadFeed, loadPortfolio, loadProfile, loadTradeHistory]);

  useEffect(() => {
    if (window.localStorage.getItem('heystockers:guide-seen') === '1') return;
    const guideTimer = window.setTimeout(() => setGuideOpen(true), 0);
    return () => window.clearTimeout(guideTimer);
  }, []);
  useEffect(() => {
    // Restore the last active tab after hydration so a refresh stays put.
    const stored = window.localStorage.getItem(TAB_KEY) as MainTab | null;
    if (!stored || !MAIN_TABS.includes(stored)) return;
    const tabTimer = window.setTimeout(() => setActiveTab(stored), 0);
    return () => window.clearTimeout(tabTimer);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(TAB_KEY, activeTab);
  }, [activeTab]);
  useEffect(() => {
    if (!toast) return;
    const toastTimer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(toastTimer);
  }, [toast]);
  useEffect(() => {
    const feedTimer = window.setTimeout(() => void loadFeed(''), 0);
    const quotesInit = window.setTimeout(() => void loadQuotes(), 0);
    const quotesTimer = window.setInterval(() => { if (!document.hidden) void loadQuotes(); }, 10_000);
    return () => { window.clearTimeout(feedTimer); window.clearTimeout(quotesInit); window.clearInterval(quotesTimer); };
  }, [loadFeed, loadQuotes]);
  useEffect(() => {
    // Keep call prices and outcomes moving without a manual reload.
    const feedPoll = window.setInterval(() => { if (!document.hidden) void loadFeed(walletAddress); }, 45_000);
    return () => window.clearInterval(feedPoll);
  }, [loadFeed, walletAddress]);
  useEffect(() => {
    const provider = getWalletProvider();
    if (!provider) return;
    const handleAccountChanged = (publicKey: { toString(): string } | null) => applyAddress(publicKey?.toString() ?? '');
    if (provider.publicKey) {
      const address = provider.publicKey.toString();
      queueMicrotask(() => applyAddress(address));
    } else {
      // On a browser refresh the wallet does not repopulate publicKey, so
      // eagerly reconnect without a popup if it already trusts this site.
      void connectWalletProvider(provider, { onlyIfTrusted: true })
        .then((address) => { if (address) applyAddress(address); })
        .catch(() => undefined);
    }
    provider.on?.('accountChanged', handleAccountChanged);
    return () => provider.off?.('accountChanged', handleAccountChanged);
  }, [applyAddress]);

  async function connectWallet() {
    const provider = getWalletProvider();
    if (!provider) {
      // Mobile browsers have no injected wallet; reopen inside Phantom's in-app browser.
      if (isMobileUserAgent()) {
        setToast('Opening in the Phantom app…');
        window.location.href = phantomBrowseUrl(window.location.href);
        return '';
      }
      setToast('A compatible Solana wallet is required to join the stock network.');
      return '';
    }
    try {
      const address = await connectWalletProvider(provider);
      if (!address) { setToast('Wallet connection cancelled.'); return ''; }
      applyAddress(address);
      setToast('Wallet connected. Your stock account is live.');
      return address;
    } catch { setToast('Wallet connection cancelled.'); return ''; }
  }

  async function disconnectWallet() {
    const provider = getWalletProvider();
    try {
      if (authToken) {
        void fetch(apiUrl('/api/auth/logout'), { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } }).catch(() => undefined);
      }
      clearStoredSession();
      await provider?.disconnect();
      applyAddress('');
      setTradeOpen(false);
      setToast('Wallet disconnected from HeyStockers.');
    } catch {
      setToast('Wallet could not be disconnected. Please try again.');
    }
  }

  async function authenticate() {
    let address = walletAddress;
    if (!address) address = await connectWallet();
    if (!address) return '';
    const provider = getWalletProvider();
    if (!provider?.signMessage) { setToast('This wallet does not support message signing.'); return ''; }
    setAuthStatus('signing');
    try {
      const challengeResponse = await fetch(apiUrl('/api/auth/challenge'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: address }) });
      const challenge = await challengeResponse.json() as { message?: string; challengeId?: string; error?: string };
      if (!challengeResponse.ok || !challenge.message || !challenge.challengeId) throw new Error(challenge.error ?? 'Could not start sign-in.');
      const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
      const signature = btoa(String.fromCharCode(...signed.signature));
      const verifyResponse = await fetch(apiUrl('/api/auth/verify'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: address, challengeId: challenge.challengeId, signature }) });
      const verified = await verifyResponse.json() as { token?: string; expiresAt?: string; error?: string };
      if (!verifyResponse.ok || !verified.token) throw new Error(verified.error ?? 'Wallet signature was not verified.');
      setAuthToken(verified.token);
      setAuthStatus('ready');
      if (verified.expiresAt) storeSession({ token: verified.token, wallet: address, expiresAt: verified.expiresAt });
      setToast('Wallet verified. You can publish and signal calls.');
      return verified.token;
    } catch (error) {
      setAuthStatus('idle');
      setToast(error instanceof Error ? error.message : 'Sign-in failed.');
      return '';
    }
  }

  async function requireToken() { return authToken || authenticate(); }
  async function requireSocialToken() {
    if (!profile) {
      setCommunityOpen(true);
      setToast('Create a username before joining the social feed.');
      return '';
    }
    return requireToken();
  }
  async function publishCall() {
    const liveEntry = portfolio?.prices[symbol] ?? marketPrices[symbol] ?? null;
    const target = Number(targetPrice);
    if (liveEntry === null) { setToast('A live entry price is required.'); return; }
    if (!Number.isFinite(target) || (callSide === 'BUY' ? target <= liveEntry : target >= liveEntry)) { setToast(callSide === 'BUY' ? 'Buy target must be above the live price.' : 'Sell target must be below the live price.'); return; }
    if (thesis.trim().length < 10) { setToast('Explain the call in at least 10 characters.'); return; }
    const token = await requireSocialToken();
    if (!token) return;
    setPosting(true);
    try {
      const deadline = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000).toISOString();
      setCallDraft({ symbol, side: callSide, targetPrice: target, deadline, commitmentUsdc, thesis: thesis.trim() });
      setPendingTradeProof(null);
      setToast('Approve the matching trade to publish this call. Rejecting creates no post.');
      openTrade(symbol, callSide === 'SELL' ? 'sell' : 'buy', commitmentUsdc);
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not prepare the call.'); }
    finally { setPosting(false); }
  }

  async function toggleSignal(call: PositionCall) {
    const token = await requireSocialToken();
    if (!token) return;
    // Optimistic flip; reverted if the API rejects it.
    setCalls((current) => current.map((item) => item.id === call.id
      ? { ...item, signaled: !call.signaled, signalCount: call.signalCount + (call.signaled ? -1 : 1) }
      : item));
    const response = await fetch(apiUrl('/api/social/reactions'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ callId: call.id }) });
    if (!response.ok) {
      setCalls((current) => current.map((item) => item.id === call.id
        ? { ...item, signaled: call.signaled, signalCount: call.signalCount }
        : item));
      setToast('Signal could not be updated.');
    } else {
      setToast(call.signaled ? 'Signal removed.' : 'You agreed with this call.');
    }
  }
  async function toggleFollow(author: string) {
    const token = await requireSocialToken();
    if (!token) return false;
    const wasFollowing = calls.find((item) => item.wallet === author)?.following ?? false;
    setCalls((current) => current.map((item) => item.wallet === author ? { ...item, following: !wasFollowing } : item));
    try {
      const response = await fetch(apiUrl('/api/social/follows'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ wallet: author }) });
      const payload = await response.json() as { following?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Follow could not be updated.');
      setCalls((current) => current.map((item) => item.wallet === author ? { ...item, following: Boolean(payload.following) } : item));
      if (walletAddress) void loadProfile(walletAddress);
      const authorName = calls.find((item) => item.wallet === author)?.username;
      const handle = authorName ? `@${authorName}` : shortenAddress(author);
      setToast(payload.following ? `Following ${handle}.` : `Unfollowed ${handle}.`);
      return Boolean(payload.following);
    } catch (error) {
      setCalls((current) => current.map((item) => item.wallet === author ? { ...item, following: wasFollowing } : item));
      throw error;
    }
  }
  // The portfolio RPC read is cached for ~30s, so poll fresh reads while the
  // just-submitted trade confirms on-chain.
  function scheduleFreshPortfolio(address: string) {
    if (!address) return;
    for (const delay of [3_000, 8_000, 15_000, 25_000]) {
      window.setTimeout(() => void loadPortfolio(address, true), delay);
    }
  }
  // Verify the swap on-chain, save it to trade history, and confirm to the user.
  async function recordTrade(address: string, signature: string) {
    for (const delay of [2_500, 6_000, 10_000]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const response = await fetch(apiUrl('/api/trades/record'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature, wallet: address }) });
        if (response.ok) {
          setToast('Trade confirmed on-chain and saved to your history.');
          void loadTradeHistory(address);
          void loadPortfolio(address, true);
          return;
        }
        if (response.status !== 409) return;
      } catch { /* transient; retry */ }
    }
  }
  function openTrade(asset: string, side: 'buy' | 'sell', amount?: number) { setTradeAsset(asset); setTradeSide(side); setTradeAmount(amount); setTradeOpen(true); }
  function suggestTarget(nextSymbol: string, nextSide: 'BUY' | 'SELL') {
    const price = portfolio?.prices[nextSymbol] ?? marketPrices[nextSymbol] ?? null;
    setTargetPrice(price === null ? '' : (price * (nextSide === 'BUY' ? 1.05 : .95)).toFixed(2));
  }
  async function publishExecutedCall(call: CallDraft, signature: string) {
    const token = await requireSocialToken();
    if (!token) throw new Error('Verify your wallet to publish this completed trade.');
    const response = await fetch(apiUrl('/api/social/posts'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...call, signature }) });
    const payload = await response.json() as { call?: { id: string }; error?: string };
    if (!response.ok || !payload.call) throw new Error(payload.error ?? 'Trade submitted, but confirmation is still pending.');
    setPendingTradeProof(null);
    setCallDraft(null);
    setThesis('');
    setTradeOpen(false);
    setToast('Trade verified. Your position call is now public.');
    scheduleFreshPortfolio(walletAddress);
    void recordTrade(walletAddress, signature);
    await loadFeed(walletAddress);
  }
  async function tradeExecuted(signature: string) {
    if (!callDraft) {
      setToast('Trade submitted. Waiting for on-chain confirmation…');
      scheduleFreshPortfolio(walletAddress);
      void recordTrade(walletAddress, signature);
      return;
    }
    const proof = { call: callDraft, signature };
    setPendingTradeProof(proof);
    try {
      await publishExecutedCall(callDraft, signature);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Trade submitted. Proof is still confirming.');
      throw error;
    }
  }
  async function retryPendingTrade() {
    if (!pendingTradeProof) return;
    try {
      await publishExecutedCall(pendingTradeProof.call, pendingTradeProof.signature);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Trade confirmation is still pending.');
    }
  }
  function closeTrade() {
    setTradeOpen(false);
    if (!pendingTradeProof) setCallDraft(null);
  }
  function closeGuide() {
    window.localStorage.setItem('heystockers:guide-seen', '1');
    setGuideOpen(false);
  }

  async function saveUserProfile(username: string) {
    const token = await requireToken();
    if (!token) throw new Error('Verify your wallet to create a username.');
    const response = await fetch(apiUrl('/api/profiles'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ username, referralCode }) });
    const payload = await response.json() as { profile?: UserProfile; referralStatus?: 'applied' | 'invalid' | 'none'; error?: string };
    if (!response.ok || !payload.profile) throw new Error(payload.error ?? 'Profile could not be saved.');
    setProfile(payload.profile);
    setToast(payload.referralStatus === 'applied' ? `Welcome @${payload.profile.username}. Your referral was recorded.` : `Welcome @${payload.profile.username}.`);
    await loadFeed(walletAddress);
  }

  const stockHoldings = useMemo(() => portfolio?.holdings.filter((holding) => holding.symbol !== 'USDC') ?? [], [portfolio]);
  const sellValues = useMemo(() => Object.fromEntries(stockHoldings.map((holding) => [holding.symbol, holding.valueUsd ?? 0])), [stockHoldings]);
  const myCalls = useMemo(() => walletAddress ? calls.filter((call) => call.wallet === walletAddress) : [], [calls, walletAddress]);
  const myRecord = useMemo(() => myCalls[0]?.record ?? { wins: 0, losses: 0 }, [myCalls]);
  const myWinRate = myRecord.wins + myRecord.losses > 0 ? Math.round((myRecord.wins / (myRecord.wins + myRecord.losses)) * 100) : null;
  // Day P&L inferred from each holding's 24h move: value/(1+chg) is yesterday's value.
  const dayPnl = useMemo(() => {
    let pnl = 0;
    let baseline = 0;
    for (const holding of stockHoldings) {
      const change = marketChanges[holding.symbol];
      if (holding.valueUsd === null || change === null || change === undefined || change <= -100) continue;
      const yesterday = holding.valueUsd / (1 + change / 100);
      pnl += holding.valueUsd - yesterday;
      baseline += yesterday;
    }
    return baseline > 0 ? { pnl, pct: (pnl / baseline) * 100 } : null;
  }, [stockHoldings, marketChanges]);
  const myCallsPnl = useMemo(() => {
    const known = myCalls.map(callPnl).filter((value): value is number => value !== null);
    return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
  }, [myCalls]);

  function handleTabListKey(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = MAIN_TABS.indexOf(activeTab);
    const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : MAIN_TABS.length - 1)) % MAIN_TABS.length;
    setActiveTab(MAIN_TABS[nextIndex]);
    event.currentTarget.querySelectorAll('button')[nextIndex]?.focus();
  }

  return (
    <main className="social-app">
      <header className="social-topbar">
        <a className="social-brand" href="#trade" aria-label="HeyStockers home" onClick={(event) => { event.preventDefault(); setActiveTab('market'); }}>
          <Image src="/heystockers-mark.svg" alt="" width={24} height={24} priority />
          <span>HEYSTOCKERS</span>
        </a>
        <PeopleSearch walletAddress={walletAddress} profile={profile} onFollow={toggleFollow} />
        <div className="topbar-actions">
          <button type="button" className="people-topbar" onClick={() => setCommunityOpen(true)}>{walletAddress ? profile ? `People · @${profile.username}` : 'People · Set username' : 'People'}</button>
          {walletAddress ? <button type="button" className="disconnect-button" onClick={disconnectWallet}>Disconnect</button> : <button type="button" className="connect-button" onClick={connectWallet}>Connect wallet</button>}
        </div>
      </header>

      <div className="seeker-banner" aria-label="HeyStockers is on the Solana dApp Store. Search HeyStockers on your Solana Seeker to install it.">
        <strong>NOW ON THE SOLANA dApp STORE</strong>
        <span>SEARCH &ldquo;HEYSTOCKERS&rdquo; ON YOUR SEEKER TO INSTALL</span>
      </div>

      <div className="zero-fee-banner" aria-label="Launch offer: zero percent HeyStockers platform fee. Network and market costs may apply.">
        <i aria-hidden="true" />
        <strong>0% HEYSTOCKERS FEE</strong>
        <span>LAUNCH OFFER · NETWORK AND MARKET COSTS MAY APPLY</span>
      </div>

      <nav className="tab-nav" role="tablist" aria-label="Main sections" onKeyDown={handleTabListKey}>
        <button type="button" role="tab" aria-selected={activeTab === 'feed'} className={activeTab === 'feed' ? 'active' : ''} onClick={() => setActiveTab('feed')}>Feed</button>
        <button type="button" role="tab" aria-selected={activeTab === 'market'} className={activeTab === 'market' ? 'active' : ''} onClick={() => setActiveTab('market')}>Market</button>
        <button type="button" role="tab" aria-selected={activeTab === 'portfolio'} className={activeTab === 'portfolio' ? 'active' : ''} onClick={() => setActiveTab('portfolio')}>Portfolio</button>
      </nav>

      <div className="simple-shell">
        {activeTab === 'market' && <section className="product-section trade-section" id="trade">
          <div className="section-heading">
            <div><h1>Buy &amp; sell stocks.</h1><button type="button" className="text-button" onClick={() => setGuideOpen(true)}>How it works</button></div>
            <div className="buying-power"><span>Cash to invest</span><strong>{walletAddress ? portfolioStatus === 'loading' ? '…' : formatUsd(portfolio?.usdcValueUsd ?? 0) : '—'}</strong></div>
          </div>
          <p className="market-label"><i className="live-dot" aria-hidden="true" />Live prices &amp; 24h change · all {TRADE_ASSETS.length} stocks · refreshes every 10s. Prices flash as they move.</p>
          <div className="market-list" aria-label="Stocks available to trade">
            {TRADE_ASSETS.map((asset) => { const price = marketPrices[asset.symbol] ?? portfolio?.prices[asset.symbol] ?? null; const flash = priceFlash[asset.symbol]; const change = marketChanges[asset.symbol] ?? null; const volume = marketVolumes[asset.symbol] ?? asset.volume24h; return <article className="market-item" key={asset.symbol}>
              <span className={`stock-logo ${asset.symbol.toLowerCase()}`}><Image src={asset.logo} alt={`${asset.shortName} logo`} width={36} height={36} unoptimized /></span>
              <span className="asset-name"><b>{asset.symbol}</b><small>{asset.shortName}</small></span>
              <span className="asset-quote"><strong key={price ?? 'na'} className={`quote-price${flash ? ` flash-${flash}` : ''}`}>{formatUsd(price)}</strong><small>{change !== null && <span className={`chg-24h ${change >= 0 ? 'up' : 'down'}`}>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span>}{change !== null ? ' · ' : ''}{formatVolume(volume)} vol</small></span>
              <div className="trade-actions"><button type="button" className="buy-stock" onClick={() => openTrade(asset.symbol, 'buy')}>Buy</button><button type="button" className="sell-stock" onClick={() => openTrade(asset.symbol, 'sell')}>Sell</button></div>
            </article>; })}
          </div>
        </section>}

        {activeTab === 'portfolio' && <section className="product-section" id="portfolio">
          <div className="section-heading compact"><h2>Portfolio</h2><strong>{walletAddress ? formatUsd((portfolio?.stockValueUsd ?? 0) + (portfolio?.usdcValueUsd ?? 0)) : '—'}</strong></div>
          <div className="sub-switch" role="tablist" aria-label="Portfolio views">
            <button type="button" role="tab" aria-selected={portfolioView === 'holdings'} className={portfolioView === 'holdings' ? 'active' : ''} onClick={() => setPortfolioView('holdings')}>Holdings</button>
            <button type="button" role="tab" aria-selected={portfolioView === 'history'} className={portfolioView === 'history' ? 'active' : ''} onClick={() => setPortfolioView('history')}>History</button>
          </div>

          {portfolioView === 'holdings' && <>
            {walletAddress && portfolioStatus === 'ready' && dayPnl && <div className="track-record"><span>Today&apos;s P&L</span><strong className={`chg-24h ${dayPnl.pnl >= 0 ? 'up' : 'down'}`}>{formatSignedUsd(dayPnl.pnl)} ({dayPnl.pct >= 0 ? '+' : ''}{dayPnl.pct.toFixed(2)}%)</strong></div>}
            {!walletAddress && <p className="empty-line">Connect your wallet to see the stocks you own.</p>}
            {walletAddress && portfolioStatus === 'loading' && <p className="empty-line">Loading your stocks…</p>}
            {walletAddress && portfolioStatus === 'error' && <p className="empty-line">We couldn’t load your wallet. Try again in a moment.</p>}
            {walletAddress && portfolioStatus === 'ready' && stockHoldings.length === 0 && <p className="empty-line">You don’t own any stocks yet. Head to the Market tab to buy your first.</p>}
            {stockHoldings.map((holding) => { const asset = TRADE_ASSETS.find((candidate) => candidate.symbol === holding.symbol)!; const change = marketChanges[holding.symbol]; const dayValue = holding.valueUsd !== null && change !== null && change !== undefined && change > -100 ? holding.valueUsd - holding.valueUsd / (1 + change / 100) : null; return <button type="button" className="holding-row" key={holding.symbol} onClick={() => openTrade(holding.symbol, 'sell')}><span className={`stock-logo ${holding.symbol.toLowerCase()}`}><Image src={asset.logo} alt={`${asset.name} logo`} width={32} height={32} unoptimized /></span><span><b>{holding.symbol}</b><small>{holding.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares{dayValue !== null && <> · <span className={`chg-24h ${dayValue >= 0 ? 'up' : 'down'}`}>{formatSignedUsd(dayValue)} today</span></>} · tap to sell</small></span><strong>{formatUsd(holding.valueUsd)}</strong></button>; })}
            {walletAddress && <div className="cash-row"><span>Cash (USDC)</span><strong>{formatUsd(portfolio?.usdcValueUsd ?? 0)}</strong></div>}
          </>}

          {portfolioView === 'history' && <>
            {!walletAddress && <p className="empty-line">Connect your wallet to see your trades and calls.</p>}
            {walletAddress && <>
              <p className="market-label">On-chain trades</p>
              {tradeHistory.length === 0 && <p className="empty-line">No recorded trades yet. New trades appear here once they confirm on-chain.</p>}
              {tradeHistory.map((trade) => { const asset = TRADE_ASSETS.find((candidate) => candidate.symbol === trade.symbol); const shares = asset ? Number(trade.assetAtomic) / 10 ** asset.decimals : null; const usd = Number(trade.usdcAtomic) / 1_000_000; return <div className="history-row" key={trade.signature}>
                <span className="history-lead"><b>{trade.side === 'BUY' ? 'Bought' : 'Sold'} {trade.symbol}</b><small>{shares !== null ? `${shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares` : ''}{trade.priceUsd ? ` · at ${formatUsd(trade.priceUsd)}` : ''}{trade.blockTime ? ` · ${shortDate(trade.blockTime)}` : ''}</small></span>
                <span className="history-right"><strong>{formatUsd(usd)}</strong><em className={`outcome ${trade.side === 'BUY' ? 'open' : 'won'}`}>{trade.side}</em></span>
              </div>; })}
              <p className="market-label">Position calls</p>
            </>}
            {walletAddress && <div className="track-record"><span>Your track record</span><strong>{myRecord.wins}W · {myRecord.losses}L{myWinRate !== null ? ` · ${myWinRate}% win rate` : ''}</strong></div>}
            {walletAddress && myCallsPnl !== null && <div className="track-record"><span>Staked P&L across calls</span><strong className={`chg-24h ${myCallsPnl >= 0 ? 'up' : 'down'}`}>{formatSignedUsd(myCallsPnl)}</strong></div>}
            {walletAddress && myCalls.length === 0 && <p className="empty-line">You haven’t made any calls yet. Share your first prediction in the Feed tab.</p>}
            {myCalls.map((call) => { const pnl = callPnl(call); return <div className="history-row" key={call.id}>
              <span className="history-lead"><b>{call.side === 'BUY' ? 'Buy' : 'Sell'} {call.symbol}</b><small>Target {formatUsd(call.targetPrice)} · {call.outcome === 'OPEN' ? `open · ${shortDate(call.deadline)}` : `closed ${call.resolvedAt ? shortDate(call.resolvedAt) : ''}`}</small></span>
              <span className="history-right">{pnl !== null && <strong className={`chg-24h ${pnl >= 0 ? 'up' : 'down'}`}>{formatSignedUsd(pnl)}</strong>}<em className={`outcome ${call.outcome.toLowerCase()}`}>{call.outcome === 'OPEN' ? 'Live' : call.outcome === 'WON' ? 'Hit' : 'Missed'}</em></span>
            </div>; })}
          </>}
        </section>}

        {activeTab === 'feed' && <section className="product-section" id="calls">
          <div className="section-heading compact"><h2>Feed</h2><span>{feedStatus === 'loading' ? '…' : `${calls.length} calls`}</span></div>
          <p className="market-label">Predict where a stock is headed, stake USDC, and prove it on-chain.</p>
          <div className="position-composer">
            <div className="call-fields">
              <label><span>Stock</span><select value={symbol} onChange={(event) => { setSymbol(event.target.value); suggestTarget(event.target.value, callSide); }}>{TRADE_ASSETS.map((asset) => <option key={asset.symbol} value={asset.symbol}>{asset.symbol}</option>)}</select></label>
              <label><span>Your call</span><div className="stance-switch">{(['BUY', 'SELL'] as const).map((value) => <button key={value} type="button" className={callSide === value ? 'active' : ''} onClick={() => { setCallSide(value); suggestTarget(symbol, value); }}>{value === 'BUY' ? 'Up' : 'Down'}</button>)}</div></label>
              <label><span>Target price</span><div className="compact-input"><i>$</i><input type="number" min="0.01" step="0.01" value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} placeholder="0.00" /></div></label>
              <label><span>Deadline</span><select value={deadlineDays} onChange={(event) => setDeadlineDays(Number(event.target.value))}><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option></select></label>
              <label><span>Stake</span><div className="compact-input"><input type="number" min="1" max="25" step="1" value={commitmentUsdc} onChange={(event) => setCommitmentUsdc(Math.max(1, Math.min(25, Number(event.target.value))))} /></div></label>
            </div>
            <div className="entry-line"><span>Current price</span><strong>{formatUsd(portfolio?.prices[symbol] ?? marketPrices[symbol] ?? null)}</strong></div>
            <textarea value={thesis} maxLength={280} onChange={(event) => setThesis(event.target.value)} placeholder="Why will it hit this target? Share your reasoning." aria-label="Reason for your call" />
            <button type="button" className="publish-call" disabled={posting} onClick={publishCall}>{posting ? 'Preparing…' : 'Review trade'}</button>
            {pendingTradeProof && <button type="button" className="verify-button" onClick={retryPendingTrade}>Verify submitted trade</button>}
            <p className="empty-line">You approve a matching trade, we verify it on-chain, then your call goes public. Reject the trade and nothing is posted.</p>
          </div>
          {walletAddress && authStatus !== 'ready' && <button type="button" className="verify-button" onClick={authenticate}>{authStatus === 'signing' ? 'Check your wallet…' : 'Verify wallet to post'}</button>}
          {feedStatus === 'error' && <p className="empty-line">The feed is unavailable right now.</p>}
          {feedStatus === 'ready' && calls.length === 0 && <p className="empty-line">No calls yet. Be the first to make one.</p>}
          <div className="call-list">{calls.map((call) => <article className="position-call" key={call.id}>
            <div className="call-meta"><span><b>{call.username ? `@${call.username}` : shortenAddress(call.wallet)}</b><small>{call.record.wins}W · {call.record.losses}L · {timeAgo(call.createdAt)} ago</small></span>{walletAddress && call.wallet !== walletAddress && <button type="button" onClick={() => void toggleFollow(call.wallet).catch((error) => setToast(error instanceof Error ? error.message : 'Follow could not be updated.'))}>{call.following ? 'Following' : 'Follow'}</button>}</div>
            <div className="call-title"><span><b>{call.side === 'BUY' ? 'UP' : 'DOWN'}</b> {call.symbol}</span><div><em className={`outcome ${call.outcome.toLowerCase()}`}>{call.outcome === 'OPEN' ? 'LIVE' : call.outcome === 'WON' ? 'HIT' : 'MISSED'}</em><em title="This trade was verified on the Solana blockchain">Verified</em></div></div>
            <div className="call-numbers"><span>Entry <b>{formatUsd(call.entryPrice)}</b></span><span>Now <b>{formatUsd(call.currentPrice)}</b></span><span>Target <b>{formatUsd(call.targetPrice)}</b></span><span>By <b>{shortDate(call.deadline)}</b></span><span>Staked <b>{formatUsd(call.commitmentUsdc)}</b></span></div>
            <div className="call-progress" aria-label={`${Math.round(call.progress * 100)} percent to target`}><i style={{ width: `${call.progress * 100}%` }} /></div>
            <p>{call.thesis}</p>
            <div className="call-actions"><button type="button" className={call.signaled ? 'reacted' : ''} onClick={() => toggleSignal(call)}>Agree {call.signalCount}</button><button type="button" onClick={() => openTrade(call.symbol, call.side === 'SELL' ? 'sell' : 'buy', call.commitmentUsdc)}>Copy trade</button></div>
          </article>)}</div>
          {feedStatus === 'ready' && nextBefore && <button type="button" className="text-button" onClick={() => void loadFeed(walletAddress, { before: nextBefore, append: true })}>Load older calls</button>}
        </section>}
      </div>

      {toast && <button type="button" role="status" className="toast" onClick={() => setToast('')}>{toast}<span>×</span></button>}
      <CommunityModal key={`${communityOpen}-${profile?.username ?? 'new'}`} open={communityOpen} walletAddress={walletAddress} profile={profile} referralCode={referralCode} onClose={() => setCommunityOpen(false)} onSave={saveUserProfile} onFollow={toggleFollow} />
      <OnboardingGuide open={guideOpen} onClose={closeGuide} />
      <TradeModal key={`${tradeOpen}-${tradeAsset}-${tradeSide}-${tradeAmount ?? ''}`} open={tradeOpen} walletAddress={walletAddress} initialAsset={tradeAsset} initialSide={tradeSide} initialDollars={tradeAmount} assetPrices={{ ...portfolio?.prices, ...marketPrices }} maxBuyUsd={walletAddress ? portfolio?.usdcValueUsd ?? 0 : 25} sellValues={sellValues} locked={Boolean(callDraft)} onClose={closeTrade} onConnect={connectWallet} onExecuted={tradeExecuted} />
    </main>
  );
}
