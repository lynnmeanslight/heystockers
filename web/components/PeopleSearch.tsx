'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';
import type { UserProfile } from './CommunityModal';

type Props = {
  walletAddress: string;
  profile: UserProfile | null;
  onFollow(wallet: string): Promise<boolean>;
};

export function PeopleSearch({ walletAddress, profile, onFollow }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserProfile[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'ready' | 'error'>('idle');

  const normalizedQuery = query.trim().replace(/^@/, '');

  useEffect(() => {
    if (normalizedQuery.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus('searching');
      try {
        const params = new URLSearchParams({
          q: normalizedQuery,
          ...(walletAddress ? { viewer: walletAddress } : {}),
        });
        const response = await fetch(apiUrl(`/api/profiles/search?${params.toString()}`), {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload = await response.json() as { profiles?: UserProfile[] };
        if (!response.ok) throw new Error('Search unavailable');
        setResults(payload.profiles ?? []);
        setStatus('ready');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setResults([]);
        setStatus('error');
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, walletAddress]);

  function updateQuery(value: string) {
    setQuery(value.toLowerCase());
    if (value.trim().replace(/^@/, '').length < 2) {
      setResults([]);
      setStatus('idle');
    }
  }

  async function follow(candidate: UserProfile) {
    try {
      const following = await onFollow(candidate.wallet);
      setResults((current) => current.map((item) => item.wallet === candidate.wallet ? { ...item, following } : item));
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="header-people-search">
      <span aria-hidden="true">⌕</span>
      <input
        aria-label="Search people"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        onChange={(event) => updateQuery(event.target.value)}
        placeholder="Search people"
        value={query}
      />
      {query && <button type="button" aria-label="Clear people search" onClick={() => updateQuery('')}>×</button>}

      {normalizedQuery.length >= 2 && (
        <div className="header-people-results" role="listbox" aria-label="People search results">
          {status === 'searching' && <p>Searching…</p>}
          {status === 'error' && <p>Search unavailable.</p>}
          {status === 'ready' && results.length === 0 && <p>No users found.</p>}
          {results.map((candidate) => (
            <article key={candidate.wallet} role="option" aria-selected="false">
              <span className="profile-initial">{candidate.username.slice(0, 1).toUpperCase()}</span>
              <span><b>@{candidate.username}</b><small>{candidate.wins}W–{candidate.losses}L · {candidate.followerCount} followers</small></span>
              {profile && candidate.wallet !== walletAddress && (
                <button type="button" onClick={() => void follow(candidate)}>{candidate.following ? 'FOLLOWING' : 'FOLLOW'}</button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
