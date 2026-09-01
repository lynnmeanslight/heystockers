'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/api';

export type UserProfile = {
  wallet: string;
  username: string;
  referralCode: string;
  referralCount: number;
  followerCount: number;
  followingCount: number;
  wins: number;
  losses: number;
  following: boolean;
};

type Props = {
  open: boolean;
  walletAddress: string;
  profile: UserProfile | null;
  referralCode: string;
  onClose(): void;
  onSave(username: string): Promise<void>;
  onFollow(wallet: string): Promise<boolean>;
};

export function CommunityModal({ open, walletAddress, profile, referralCode, onClose, onSave, onFollow }: Props) {
  const [username, setUsername] = useState(profile?.username ?? '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserProfile[]>([]);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');
  const [connections, setConnections] = useState<{ followers: UserProfile[]; following: UserProfile[] } | null>(null);
  const [connectionsStatus, setConnectionsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(profile ? 'loading' : 'idle');
  const [connectionsView, setConnectionsView] = useState<'followers' | 'following'>('followers');
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const profileWallet = profile?.wallet ?? '';
  useEffect(() => {
    if (!open || !profileWallet) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const params = new URLSearchParams({ wallet: profileWallet, viewer: walletAddress || profileWallet });
        const response = await fetch(apiUrl(`/api/profiles/connections?${params.toString()}`), { cache: 'no-store', signal: controller.signal });
        const payload = await response.json() as { followers?: UserProfile[]; following?: UserProfile[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Connections are unavailable.');
        setConnections({ followers: payload.followers ?? [], following: payload.following ?? [] });
        setConnectionsStatus('ready');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setConnectionsStatus('error');
      }
    })();
    return () => controller.abort();
  }, [open, profileWallet, walletAddress]);

  if (!open) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await onSave(username);
      setMessage('Username saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Username could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().replace(/^@/, '').length < 2) {
      setMessage('Enter at least 2 characters.');
      return;
    }
    setSearching(true);
    setMessage('');
    try {
      const params = new URLSearchParams({ q: query, ...(walletAddress ? { viewer: walletAddress } : {}) });
      const response = await fetch(apiUrl(`/api/profiles/search?${params.toString()}`), { cache: 'no-store' });
      const payload = await response.json() as { profiles?: UserProfile[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Search is unavailable.');
      setResults(payload.profiles ?? []);
      if (!payload.profiles?.length) setMessage('No usernames found.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Search is unavailable.');
    } finally {
      setSearching(false);
    }
  }

  async function copyInvite() {
    if (!profile) return;
    await navigator.clipboard.writeText(`https://heystockers.trade/?ref=${profile.referralCode}`);
    setMessage('Invite link copied.');
  }

  async function follow(candidate: UserProfile) {
    try {
      const following = await onFollow(candidate.wallet);
      setResults((current) => current.map((item) => item.wallet === candidate.wallet ? { ...item, following } : item));
      setConnections((current) => {
        if (!current) return current;
        const updatedCandidate = { ...candidate, following };
        return {
          followers: current.followers.map((item) => item.wallet === candidate.wallet ? { ...item, following } : item),
          following: following
            ? current.following.some((item) => item.wallet === candidate.wallet)
              ? current.following.map((item) => item.wallet === candidate.wallet ? updatedCandidate : item)
              : [updatedCandidate, ...current.following]
            : current.following.filter((item) => item.wallet !== candidate.wallet),
        };
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Follow could not be updated.');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="community-modal" role="dialog" aria-modal="true" aria-labelledby="community-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-topline"><span>COMMUNITY</span><button type="button" onClick={onClose} aria-label="Close community">×</button></div>
        <h2 id="community-title">{profile ? `@${profile.username}` : 'Find your people.'}</h2>

        {walletAddress && !profile && (
          <form className="username-form" onSubmit={save}>
            <label htmlFor="username">CLAIM YOUR USERNAME</label>
            <div><span>@</span><input id="username" autoCapitalize="none" autoCorrect="off" maxLength={20} value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="stocktrader" /></div>
            <small>3–20 characters · starts with a letter</small>
            {referralCode && <small>INVITE DETECTED · {referralCode.toUpperCase()}</small>}
            <button type="submit" disabled={saving}>{saving ? 'SAVING…' : 'CREATE PROFILE'}</button>
          </form>
        )}

        {!walletAddress && <p className="community-note">Connect your wallet to claim a username. Search remains public.</p>}

        {profile && (
          <div className="invite-card">
            <div><strong>{profile.referralCount}</strong><span>REFERRALS</span></div>
            <div><strong>{profile.followerCount}</strong><span>FOLLOWERS</span></div>
            <div><strong>{profile.wins}W–{profile.losses}L</strong><span>RECORD</span></div>
            <button type="button" onClick={copyInvite}>COPY INVITE</button>
          </div>
        )}

        {profile && (
          <div className="connections">
            <div className="sub-switch" role="tablist" aria-label="Your connections">
              <button type="button" role="tab" aria-selected={connectionsView === 'followers'} className={connectionsView === 'followers' ? 'active' : ''} onClick={() => setConnectionsView('followers')}>Followers ({profile.followerCount})</button>
              <button type="button" role="tab" aria-selected={connectionsView === 'following'} className={connectionsView === 'following' ? 'active' : ''} onClick={() => setConnectionsView('following')}>Following ({profile.followingCount})</button>
            </div>
            <div className="people-results">
              {connectionsStatus === 'loading' && <p className="community-note" role="status">Loading connections…</p>}
              {connectionsStatus === 'error' && <p className="community-note" role="alert">Connections could not be loaded. Try reopening Community.</p>}
              {connectionsStatus === 'ready' && connections && (connectionsView === 'followers' ? connections.followers : connections.following).length === 0 && (
                <p className="community-note">{connectionsView === 'followers' ? 'No followers yet. Publish verified calls to earn them.' : 'You are not following anyone yet. Find traders below.'}</p>
              )}
              {connectionsStatus === 'ready' && connections && (connectionsView === 'followers' ? connections.followers : connections.following).map((candidate) => (
                <article key={candidate.wallet}>
                  <span className="profile-initial">{candidate.username.slice(0, 1).toUpperCase()}</span>
                  <span><b>@{candidate.username}</b><small>{candidate.wins}W–{candidate.losses}L · {candidate.followerCount} followers</small></span>
                  {candidate.wallet !== walletAddress && <button type="button" onClick={() => follow(candidate)}>{candidate.following ? 'FOLLOWING' : 'FOLLOW'}</button>}
                </article>
              ))}
            </div>
          </div>
        )}

        <form className="people-search" onSubmit={search}>
          <label htmlFor="people-search">SEARCH USERNAMES</label>
          <div><input id="people-search" autoCapitalize="none" autoCorrect="off" value={query} onChange={(event) => setQuery(event.target.value.toLowerCase())} placeholder="@username" /><button type="submit" disabled={searching}>{searching ? '…' : 'FIND'}</button></div>
        </form>

        <div className="people-results">
          {results.map((candidate) => (
            <article key={candidate.wallet}>
              <span className="profile-initial">{candidate.username.slice(0, 1).toUpperCase()}</span>
              <span><b>@{candidate.username}</b><small>{candidate.wins}W–{candidate.losses}L · {candidate.followerCount} followers</small></span>
              {profile && candidate.wallet !== walletAddress && <button type="button" onClick={() => follow(candidate)}>{candidate.following ? 'FOLLOWING' : 'FOLLOW'}</button>}
            </article>
          ))}
        </div>
        {message && <p className="community-message" role="status">{message}</p>}
      </section>
    </div>
  );
}
