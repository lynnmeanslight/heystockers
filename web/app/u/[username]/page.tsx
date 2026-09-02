import type { Metadata } from 'next';
import { cache } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

type PublicProfile = {
  wallet: string;
  username: string;
  referralCount: number;
  followerCount: number;
  followingCount: number;
  wins: number;
  losses: number;
};
type ProfileCall = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  thesis: string;
  entryPrice: number;
  targetPrice: number;
  currentPrice: number | null;
  deadline: string;
  commitmentUsdc: number;
  outcome: 'OPEN' | 'WON' | 'LOST';
  resolvedAt: string | null;
  resolvedPrice: number | null;
  createdAt: string;
  signalCount: number;
};

// Server-side reads go straight to the API Worker; browser CORS does not apply.
const API_BASE = process.env.NEXT_PUBLIC_HEYSTOCKERS_API_URL?.trim().replace(/\/$/, '') || 'https://api.heystockers.trade';

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}
function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value));
}
function accuracyPct(profile: Pick<PublicProfile, 'wins' | 'losses'>) {
  const settled = profile.wins + profile.losses;
  return settled > 0 ? Math.round((profile.wins / settled) * 100) : null;
}

// cache() dedupes the metadata + page calls within one request; no-store skips Next's fetch cache.
const loadProfile = cache(async (username: string) => {
  try {
    const response = await fetch(`${API_BASE}/api/profiles/by-username?username=${encodeURIComponent(username)}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    return ((await response.json()) as { profile?: PublicProfile }).profile ?? null;
  } catch {
    return null;
  }
});

async function loadCalls(wallet: string) {
  try {
    const response = await fetch(`${API_BASE}/api/social/feed?author=${encodeURIComponent(wallet)}&limit=20`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return [];
    return ((await response.json()) as { calls?: ProfileCall[] }).calls ?? [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const profile = await loadProfile(username);
  if (!profile) return { title: 'Stocker not found · HeyStockers' };
  const accuracy = accuracyPct(profile);
  const title = `@${profile.username} · ${profile.wins}W-${profile.losses}L on HeyStockers`;
  const description = accuracy === null
    ? `@${profile.username} is building an on-chain stock track record on HeyStockers. Every call is backed by a verified Solana trade.`
    : `@${profile.username} has ${profile.wins} hits and ${profile.losses} misses (${accuracy}% accuracy) with ${profile.followerCount} followers. Every call is backed by a verified Solana trade.`;
  return {
    title,
    description,
    alternates: { canonical: `/u/${profile.username}` },
    openGraph: { title, description, url: `/u/${profile.username}`, images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HeyStockers stock SocialFi network' }] },
    twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await loadProfile(username);
  if (!profile) notFound();
  const calls = await loadCalls(profile.wallet);
  const accuracy = accuracyPct(profile);
  const shortWallet = `${profile.wallet.slice(0, 4)}…${profile.wallet.slice(-4)}`;

  return (
    <main className="social-app">
      <header className="social-topbar profile-topbar">
        <Link className="social-brand" href="/" aria-label="HeyStockers home">
          <Image src="/heystockers-mark.svg" alt="" width={24} height={24} priority />
          <span>HEYSTOCKERS</span>
        </Link>
        <span />
        <div className="topbar-actions"><Link className="connect-button" href="/">Open the app</Link></div>
      </header>
      <div className="simple-shell">
        <section className="product-section" id="profile">
          <div className="profile-hero">
            <h1>@{profile.username}</h1>
            <p>Verified Solana wallet {shortWallet} · every call below is backed by an on-chain trade.</p>
          </div>
          <div className="profile-stats">
            <span>Record<strong>{profile.wins}W · {profile.losses}L</strong></span>
            <span>Accuracy<strong>{accuracy === null ? '—' : `${accuracy}%`}</strong></span>
            <span>Followers<strong>{profile.followerCount}</strong></span>
            <span>Following<strong>{profile.followingCount}</strong></span>
            <span>Invites<strong>{profile.referralCount}</strong></span>
          </div>
          <p className="market-label">Latest position calls</p>
          {calls.length === 0 && <p className="empty-line">No public calls yet.</p>}
          <div className="call-list">
            {calls.map((call) => (
              <article className="position-call" key={call.id}>
                <div className="call-title"><span><b>{call.side === 'BUY' ? 'UP' : 'DOWN'}</b> {call.symbol}</span><div><em className={`outcome ${call.outcome.toLowerCase()}`}>{call.outcome === 'OPEN' ? 'LIVE' : call.outcome === 'WON' ? 'HIT' : 'MISSED'}</em><em title="This trade was verified on the Solana blockchain">Verified</em></div></div>
                <div className="call-numbers"><span>Entry <b>{formatUsd(call.entryPrice)}</b></span><span>{call.outcome === 'OPEN' ? 'Now' : 'Settled'} <b>{formatUsd(call.outcome === 'OPEN' ? call.currentPrice : call.resolvedPrice)}</b></span><span>Target <b>{formatUsd(call.targetPrice)}</b></span><span>By <b>{shortDate(call.deadline)}</b></span><span>Staked <b>{formatUsd(call.commitmentUsdc)}</b></span></div>
                <p>{call.thesis}</p>
              </article>
            ))}
          </div>
          <p className="empty-line">Want to follow @{profile.username} or copy a call? <Link className="author-link" href="/"><b>Open HeyStockers</b></Link> and connect your wallet.</p>
        </section>
      </div>
    </main>
  );
}
