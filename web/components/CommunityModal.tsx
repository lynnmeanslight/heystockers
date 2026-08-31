'use client';

import { FormEvent, useState } from 'react';
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Follow could not be updated.');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="community-modal" role="dialog" aria-modal="true" aria-labelledby="community-title" onMouseDown={(event) => event.stopPropagation()}>
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
