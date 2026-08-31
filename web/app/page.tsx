'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { CommunityModal, type UserProfile } from '../components/CommunityModal';
import { OnboardingGuide } from '../components/OnboardingGuide';
import { PeopleSearch } from '../components/PeopleSearch';
import { TradeModal } from '../components/TradeModal';
import { apiUrl } from '../lib/api';
import { TRADE_ASSETS } from '../lib/assets';

type Holding = { symbol: string; name: string; amount: number; priceUsd: number | null; valueUsd: number | null };
type PortfolioResponse = { wallet: string; stockValueUsd: number; usdcValueUsd: number; holdings: Holding[]; prices: Record<string, number | null>; updatedAt: string; source: string; error?: string };
type PositionCall = { id: string; wallet: string; username: string | null; symbol: string; side: 'BUY' | 'SELL'; thesis: string; entryPrice: number; targetPrice: number; currentPrice: number | null; deadline: string; commitmentUsdc: number; executionSignature: string | null; outcome: 'OPEN' | 'WON' | 'LOST'; progress: number; createdAt: string; signalCount: number; signaled: boolean; following: boolean; record: { wins: number; losses: number } };
type CallDraft = { symbol: string; side: 'BUY' | 'SELL'; targetPrice: number; deadline: string; commitmentUsdc: number; thesis: string };
type PendingTradeProof = { call: CallDraft; signature: string };

function shortenAddress(address: string) { return address ? `${address.slice(0, 4)}…${address.slice(-4)}` : 'Not connected'; }
function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}
function formatVolume(value: number | null | undefined) {
  if (!value) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
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
  const [marketExpanded, setMarketExpanded] = useState(false);
  const [calls, setCalls] = useState<PositionCall[]>([]);
  const [feedStatus, setFeedStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [portfolioStatus, setPortfolioStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
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
  const [referralCode] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('ref')?.trim() ?? '');

  const loadFeed = useCallback(async (viewer = '') => {
    try {
      const params = viewer ? `?viewer=${encodeURIComponent(viewer)}` : '';
      const response = await fetch(apiUrl(`/api/social/feed${params}`), { cache: 'no-store' });
      const payload = await response.json() as { calls?: PositionCall[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Feed unavailable');
      setCalls(payload.calls ?? []);
      setFeedStatus('ready');
    } catch {
      setCalls([]);
      setFeedStatus('error');
    }
  }, []);

  const loadPortfolio = useCallback(async (address: string) => {
    setPortfolioStatus('loading');
    try {
      const response = await fetch(apiUrl(`/api/portfolio?wallet=${encodeURIComponent(address)}`), { cache: 'no-store' });
      const payload = await response.json() as PortfolioResponse;
      if (!response.ok) throw new Error(payload.error ?? 'Wallet read failed');
      setPortfolio(payload);
      setPortfolioStatus('ready');
    } catch {
      setPortfolio(null);
      setPortfolioStatus('error');
    }
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

  useEffect(() => {
    if (window.localStorage.getItem('heystockers:guide-seen') === '1') return;
    const guideTimer = window.setTimeout(() => setGuideOpen(true), 0);
    return () => window.clearTimeout(guideTimer);
  }, []);
  useEffect(() => {
    const feedTimer = window.setTimeout(() => void loadFeed(''), 0);
    void fetch(apiUrl('/api/stocks/quotes')).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { prices?: Record<string, number | null>; volumes?: Record<string, number> };
      setMarketPrices(payload.prices ?? {});
      setMarketVolumes(payload.volumes ?? {});
      const initialPrice = payload.prices?.NVDAx ?? null;
      if (initialPrice !== null) setTargetPrice((current) => current || (initialPrice * 1.05).toFixed(2));
    }).catch(() => undefined);
    return () => window.clearTimeout(feedTimer);
  }, [loadFeed]);
  useEffect(() => {
    const provider = window.phantom?.solana ?? window.solana;
    if (!provider) return;
    const applyAddress = (publicKey: { toString(): string } | null) => {
      const address = publicKey?.toString() ?? '';
      setWalletAddress(address);
      setAuthToken('');
      setAuthStatus('idle');
      if (address) {
        void loadPortfolio(address);
        void loadFeed(address);
        void loadProfile(address).then((loaded) => { if (!loaded) setCommunityOpen(true); });
      } else { setPortfolio(null); setProfile(null); setPortfolioStatus('idle'); void loadFeed(''); }
    };
    if (provider.publicKey) queueMicrotask(() => applyAddress(provider.publicKey ?? null));
    provider.on?.('accountChanged', applyAddress);
    return () => provider.off?.('accountChanged', applyAddress);
  }, [loadFeed, loadPortfolio, loadProfile]);

  async function connectWallet() {
    const provider = window.phantom?.solana ?? window.solana;
    if (!provider) { setToast('A compatible wallet is required to join the stock network.'); return ''; }
    try {
      const result = await provider.connect();
      const address = result.publicKey.toString();
      setWalletAddress(address);
      void loadPortfolio(address);
      void loadFeed(address);
      void loadProfile(address).then((loaded) => { if (!loaded) setCommunityOpen(true); });
      setToast('Wallet connected. Your stock account is live.');
      return address;
    } catch { setToast('Wallet connection cancelled.'); return ''; }
  }

  async function disconnectWallet() {
    const provider = window.phantom?.solana ?? window.solana;
    try {
      await provider?.disconnect();
      setWalletAddress('');
      setPortfolio(null);
      setProfile(null);
      setPortfolioStatus('idle');
      setAuthToken('');
      setAuthStatus('idle');
      setTradeOpen(false);
      await loadFeed('');
      setToast('Wallet disconnected from HeyStockers.');
    } catch {
      setToast('Wallet could not be disconnected. Please try again.');
    }
  }

  async function authenticate() {
    let address = walletAddress;
    if (!address) address = await connectWallet();
    if (!address) return '';
    const provider = window.phantom?.solana ?? window.solana;
    if (!provider?.signMessage) { setToast('This wallet does not support message signing.'); return ''; }
    setAuthStatus('signing');
    try {
      const challengeResponse = await fetch(apiUrl('/api/auth/challenge'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: address }) });
      const challenge = await challengeResponse.json() as { message?: string; challengeId?: string; error?: string };
      if (!challengeResponse.ok || !challenge.message || !challenge.challengeId) throw new Error(challenge.error ?? 'Could not start sign-in.');
      const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
      const signature = btoa(String.fromCharCode(...signed.signature));
      const verifyResponse = await fetch(apiUrl('/api/auth/verify'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet: address, challengeId: challenge.challengeId, signature }) });
      const verified = await verifyResponse.json() as { token?: string; error?: string };
      if (!verifyResponse.ok || !verified.token) throw new Error(verified.error ?? 'Wallet signature was not verified.');
      setAuthToken(verified.token);
      setAuthStatus('ready');
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
    const response = await fetch(apiUrl('/api/social/reactions'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ callId: call.id }) });
    if (response.ok) await loadFeed(walletAddress);
  }
  async function toggleFollow(author: string) {
    const token = await requireSocialToken();
    if (!token) return false;
    const response = await fetch(apiUrl('/api/social/follows'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ wallet: author }) });
    const payload = await response.json() as { following?: boolean; error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'Follow could not be updated.');
    await loadFeed(walletAddress);
    return Boolean(payload.following);
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
    await loadPortfolio(walletAddress);
    await loadFeed(walletAddress);
  }
  async function tradeExecuted(signature: string) {
    if (!callDraft) {
      setToast('Trade submitted successfully.');
      await loadPortfolio(walletAddress);
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
  const visibleAssets = marketExpanded ? TRADE_ASSETS : TRADE_ASSETS.slice(0, 10);

  return (
    <main className="social-app">
      <header className="social-topbar">
        <a className="social-brand" href="#trade" aria-label="HeyStockers home">
          <Image src="/heystockers-mark.svg" alt="" width={24} height={24} priority />
          <span>HEYSTOCKERS</span>
        </a>
        <PeopleSearch walletAddress={walletAddress} profile={profile} onFollow={toggleFollow} />
        <div className="topbar-actions">
          <button type="button" className="people-topbar" onClick={() => setCommunityOpen(true)}>{walletAddress ? profile ? `People · @${profile.username}` : 'People · Set username' : 'People'}</button>
          {walletAddress ? <button type="button" className="disconnect-button" onClick={disconnectWallet}>Disconnect</button> : <button type="button" className="connect-button" onClick={connectWallet}>Connect wallet</button>}
        </div>
      </header>

      <div className="zero-fee-banner" aria-label="Launch offer: zero percent HeyStockers platform fee. Network and market costs may apply.">
        <i aria-hidden="true" />
        <strong>0% HEYSTOCKERS FEE</strong>
        <span>LAUNCH OFFER · NETWORK AND MARKET COSTS MAY APPLY</span>
      </div>

      <div className="simple-shell">
        <section className="product-section trade-section" id="trade">
          <div className="section-heading">
            <div><h1>Trade stocks.</h1><button type="button" className="text-button" onClick={() => setGuideOpen(true)}>User guide</button></div>
            <div className="buying-power"><span>Buying power</span><strong>{walletAddress ? portfolioStatus === 'loading' ? '…' : formatUsd(portfolio?.usdcValueUsd ?? 0) : '—'}</strong></div>
          </div>
          <p className="market-label">Top {TRADE_ASSETS.length} by 24h Solana volume</p>
          <div className="market-list" aria-label="Stocks available to trade">
            {visibleAssets.map((asset) => { const price = portfolio?.prices[asset.symbol] ?? marketPrices[asset.symbol] ?? null; const volume = marketVolumes[asset.symbol] ?? asset.volume24h; return <article className="market-item" key={asset.symbol}>
              <span className={`stock-logo ${asset.symbol.toLowerCase()}`}><Image src={asset.logo} alt={`${asset.shortName} logo`} width={36} height={36} unoptimized /></span>
              <span className="asset-name"><b>{asset.symbol}</b><small>{asset.shortName}</small></span>
              <span className="asset-quote"><strong>{formatUsd(price)}</strong><small>{formatVolume(volume)} vol</small></span>
              <div className="trade-actions"><button type="button" className="buy-stock" onClick={() => openTrade(asset.symbol, 'buy')}>Buy</button><button type="button" className="sell-stock" onClick={() => openTrade(asset.symbol, 'sell')}>Sell</button></div>
            </article>; })}
          </div>
          {TRADE_ASSETS.length > 10 && <button type="button" className="market-toggle" onClick={() => setMarketExpanded((expanded) => !expanded)}>{marketExpanded ? 'Show top 10' : `View all ${TRADE_ASSETS.length}`}</button>}
        </section>

        <section className="product-section" id="portfolio">
          <div className="section-heading compact"><h2>Portfolio</h2><strong>{walletAddress ? formatUsd(portfolio?.stockValueUsd ?? null) : '—'}</strong></div>
          {!walletAddress && <p className="empty-line">Connect your wallet to view your stocks.</p>}
          {walletAddress && portfolioStatus === 'ready' && stockHoldings.length === 0 && <p className="empty-line">No stocks in this wallet.</p>}
          {stockHoldings.map((holding) => { const asset = TRADE_ASSETS.find((candidate) => candidate.symbol === holding.symbol)!; return <button type="button" className="holding-row" key={holding.symbol} onClick={() => openTrade(holding.symbol, 'sell')}><span className={`stock-logo ${holding.symbol.toLowerCase()}`}><Image src={asset.logo} alt={`${asset.name} logo`} width={32} height={32} unoptimized /></span><span><b>{holding.symbol}</b><small>{holding.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</small></span><strong>{formatUsd(holding.valueUsd)}</strong></button>; })}
          {walletAddress && <div className="cash-row"><span>USDC</span><strong>{formatUsd(portfolio?.usdcValueUsd ?? 0)}</strong></div>}
        </section>

        <section className="product-section" id="calls">
          <div className="section-heading compact"><h2>Position calls</h2><span>{feedStatus === 'loading' ? '…' : calls.length}</span></div>
          <div className="position-composer">
            <div className="call-fields">
              <label><span>Stock</span><select value={symbol} onChange={(event) => { setSymbol(event.target.value); suggestTarget(event.target.value, callSide); }}>{TRADE_ASSETS.map((asset) => <option key={asset.symbol} value={asset.symbol}>{asset.symbol}</option>)}</select></label>
              <label><span>Direction</span><div className="stance-switch">{(['BUY', 'SELL'] as const).map((value) => <button key={value} type="button" className={callSide === value ? 'active' : ''} onClick={() => { setCallSide(value); suggestTarget(symbol, value); }}>{value}</button>)}</div></label>
              <label><span>Target</span><div className="compact-input"><i>$</i><input type="number" min="0.01" step="0.01" value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} placeholder="0.00" /></div></label>
              <label><span>Deadline</span><select value={deadlineDays} onChange={(event) => setDeadlineDays(Number(event.target.value))}><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option></select></label>
              <label><span>Commit</span><div className="compact-input"><i>$</i><input type="number" min="1" max="25" step="1" value={commitmentUsdc} onChange={(event) => setCommitmentUsdc(Math.max(1, Math.min(25, Number(event.target.value))))} /></div></label>
            </div>
            <div className="entry-line"><span>Live entry</span><strong>{formatUsd(portfolio?.prices[symbol] ?? marketPrices[symbol] ?? null)}</strong></div>
            <textarea value={thesis} maxLength={280} onChange={(event) => setThesis(event.target.value)} placeholder="Why will this target hit?" aria-label="Reason for position call" />
            <button type="button" className="publish-call" disabled={posting} onClick={publishCall}>{posting ? 'Preparing…' : 'Review trade'}</button>
            {pendingTradeProof && <button type="button" className="verify-button" onClick={retryPendingTrade}>Verify submitted trade</button>}
            <p className="empty-line">Approve trade → verify on-chain → publish. Rejecting creates no post.</p>
          </div>
          {walletAddress && authStatus !== 'ready' && <button type="button" className="verify-button" onClick={authenticate}>{authStatus === 'signing' ? 'Check wallet…' : 'Verify wallet to publish'}</button>}
          {feedStatus === 'error' && <p className="empty-line">Position calls are unavailable.</p>}
          {feedStatus === 'ready' && calls.length === 0 && <p className="empty-line">No calls yet.</p>}
          <div className="call-list">{calls.map((call) => <article className="position-call" key={call.id}>
            <div className="call-meta"><span><b>{call.username ? `@${call.username}` : shortenAddress(call.wallet)}</b><small>{call.record.wins}W · {call.record.losses}L · {timeAgo(call.createdAt)}</small></span>{walletAddress && call.wallet !== walletAddress && <button type="button" onClick={() => toggleFollow(call.wallet)}>{call.following ? 'Following' : 'Follow'}</button>}</div>
            <div className="call-title"><span><b>{call.side}</b> {call.symbol}</span><div><em className={`outcome ${call.outcome.toLowerCase()}`}>{call.outcome}</em><em>TRADE PROOF</em></div></div>
            <div className="call-numbers"><span>Entry <b>{formatUsd(call.entryPrice)}</b></span><span>Now <b>{formatUsd(call.currentPrice)}</b></span><span>Target <b>{formatUsd(call.targetPrice)}</b></span><span>By <b>{shortDate(call.deadline)}</b></span><span>Commit <b>{formatUsd(call.commitmentUsdc)}</b></span></div>
            <div className="call-progress" aria-label={`${Math.round(call.progress * 100)} percent to target`}><i style={{ width: `${call.progress * 100}%` }} /></div>
            <p>{call.thesis}</p>
            <div className="call-actions"><button type="button" className={call.signaled ? 'reacted' : ''} onClick={() => toggleSignal(call)}>Signal {call.signalCount}</button><button type="button" onClick={() => openTrade(call.symbol, call.side === 'SELL' ? 'sell' : 'buy', call.commitmentUsdc)}>Copy trade</button></div>
          </article>)}</div>
        </section>
      </div>

      {toast && <button type="button" className="toast" onClick={() => setToast('')}>{toast}<span>×</span></button>}
      <CommunityModal key={`${communityOpen}-${profile?.username ?? 'new'}`} open={communityOpen} walletAddress={walletAddress} profile={profile} referralCode={referralCode} onClose={() => setCommunityOpen(false)} onSave={saveUserProfile} onFollow={toggleFollow} />
      <OnboardingGuide open={guideOpen} onClose={closeGuide} />
      <TradeModal key={`${tradeOpen}-${tradeAsset}-${tradeSide}-${tradeAmount ?? ''}`} open={tradeOpen} walletAddress={walletAddress} initialAsset={tradeAsset} initialSide={tradeSide} initialDollars={tradeAmount} assetPrices={{ ...marketPrices, ...portfolio?.prices }} maxBuyUsd={walletAddress ? portfolio?.usdcValueUsd ?? 0 : 25} sellValues={sellValues} locked={Boolean(callDraft)} onClose={closeTrade} onConnect={connectWallet} onExecuted={tradeExecuted} />
    </main>
  );
}
