'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../lib/api';
import { formatAtomicAmount, toAtomicAmount, TRADE_ASSETS, USDC } from '../lib/assets';
import { getWalletProvider } from '../lib/wallet';

// DFlow orders embed a recent blockhash, so a signable quote goes stale fast.
const QUOTE_TTL_MS = 45_000;

type OrderResponse = {
  transaction?: string;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: string;
  executionMode?: string;
  routePlan?: Array<{ venue?: string }>;
  error?: string;
  msg?: string;
};

type Props = {
  open: boolean;
  walletAddress: string;
  initialAsset: string;
  initialSide?: 'buy' | 'sell';
  initialDollars?: number;
  assetPrices?: Record<string, number | null>;
  maxBuyUsd?: number;
  sellValues?: Record<string, number>;
  locked?: boolean;
  onClose(): void;
  onConnect(): Promise<string>;
  onExecuted?(signature: string): void | Promise<void>;
};

function shortenAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
}

export function TradeModal({ open, walletAddress, initialAsset, initialSide = 'buy', initialDollars, assetPrices, maxBuyUsd = 25, sellValues, locked = false, onClose, onConnect, onExecuted }: Props) {
  // The modal always opens for one specific stock and side (from a market Buy/Sell,
  // a portfolio row, or a copy-trade), so both are locked to what was clicked.
  const side = initialSide;
  const symbol = TRADE_ASSETS.some((asset) => asset.symbol === initialAsset) ? initialAsset : 'NVDAx';
  const [dollars, setDollars] = useState(() => Math.min(initialDollars ?? 20, initialSide === 'buy' ? maxBuyUsd : (sellValues?.[initialAsset] ?? 0)));
  const [quote, setQuote] = useState<OrderResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'quoting' | 'signing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [quoteExpiresAt, setQuoteExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  const asset = useMemo(
    () => TRADE_ASSETS.find((candidate) => candidate.symbol === symbol) ?? TRADE_ASSETS[0],
    [symbol],
  );
  const liveAssetPrice = assetPrices?.[asset.symbol] ?? null;

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || quoteExpiresAt === null || status === 'signing' || status === 'success') return;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((quoteExpiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left > 0) return;
      setQuote(null);
      setQuoteExpiresAt(null);
      setSecondsLeft(null);
      setStatus('idle');
      setMessage('The quote expired. Preview again for a fresh route.');
    }, 500);
    return () => window.clearInterval(timer);
  }, [open, quoteExpiresAt, status]);

  if (!open) return null;

  async function requestQuote(addressOverride?: string) {
    const address = addressOverride ?? walletAddress;
    if (dollars <= 0) {
      setStatus('error');
      setMessage(`This wallet has no ${side === 'buy' ? 'USDC available' : `${asset.symbol} available`} for the order.`);
      return;
    }
    if (side === 'sell' && !liveAssetPrice) {
      setStatus('error');
      setMessage(`A live ${asset.symbol} price is required before selling.`);
      return;
    }
    setStatus('quoting');
    setMessage('Finding the best live route…');
    setQuote(null);
    setQuoteExpiresAt(null);
    setSecondsLeft(null);

    try {
      const input = side === 'buy' ? USDC : asset;
      const output = side === 'buy' ? asset : USDC;
      const params = new URLSearchParams({
        inputMint: input.mint,
        outputMint: output.mint,
        amount: toAtomicAmount(asset, side, dollars, liveAssetPrice ?? asset.referencePrice),
      });
      if (address) params.set('userPublicKey', address);

      const response = await fetch(apiUrl(`/api/trades/order?${params.toString()}`));
      const payload = (await response.json()) as OrderResponse;
      if (!response.ok) throw new Error(payload.error ?? payload.msg ?? 'Live pricing is temporarily unavailable.');

      setQuote(payload);
      setStatus('idle');
      if (payload.transaction) {
        setQuoteExpiresAt(Date.now() + QUOTE_TTL_MS);
        setSecondsLeft(Math.ceil(QUOTE_TTL_MS / 1000));
      }
      setMessage(address ? 'Live route ready. Review it before signing.' : 'Live price ready. Connect a wallet to build the transaction.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Quote failed. Please try again.');
    }
  }

  async function executeTrade() {
    try {
      let address = walletAddress;
      if (!address) address = await onConnect();
      if (!address) return;

      const activeQuote = quote;
      if (!activeQuote?.transaction) {
        // The quote predates the wallet connection; rebuild it for this signer.
        await requestQuote(address);
        return;
      }

      const provider = getWalletProvider();
      if (!provider) throw new Error('Connect a compatible wallet to sign this transaction.');

      setStatus('signing');
      setMessage('Check the transaction carefully in your wallet.');
      const { VersionedTransaction } = await import('@solana/web3.js');
      const bytes = Uint8Array.from(atob(activeQuote.transaction), (character) => character.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(bytes);
      const result = await provider.signAndSendTransaction(transaction);
      const signature = typeof result === 'string' ? result : result.signature;

      setQuoteExpiresAt(null);
      setSecondsLeft(null);
      setMessage(`Submitted: ${shortenAddress(signature)}. Verifying trade…`);
      await onExecuted?.(signature);
      setStatus('success');
      setMessage(`Confirmed: ${shortenAddress(signature)}`);
      // Plain trades close on their own; call publishing manages the modal itself.
      if (!locked) window.setTimeout(onClose, 1_600);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The wallet rejected this trade.');
    }
  }

  const inputAsset = side === 'buy' ? USDC : asset;
  const outputAsset = side === 'buy' ? asset : USDC;
  // Buy keeps the $25 launch cap; sell must allow the full holding so a position
  // larger than $25 isn't trapped. Selling only liquidates what the wallet owns.
  const orderLimit = side === 'buy' ? Math.min(25, maxBuyUsd) : (sellValues?.[asset.symbol] ?? 0);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} tabIndex={-1} className="trade-modal" role="dialog" aria-modal="true" aria-labelledby="trade-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-topline">
          <span>ORDER</span>
          <button type="button" onClick={onClose} aria-label="Close trade review">×</button>
        </div>
        <div className="trade-title-row">
          <h2 id="trade-title">{side === 'buy' ? 'Buy' : 'Sell'} {asset.symbol}</h2>
          <span className="connection-pill">{walletAddress ? shortenAddress(walletAddress) : 'WALLET NOT CONNECTED'}</span>
        </div>

        <div className="trade-price">
          <span>Current {asset.symbol} price</span>
          <strong>{formatUsd(liveAssetPrice)}</strong>
        </div>

        <label className="field-label" htmlFor="trade-amount">{side === 'buy' ? 'AMOUNT TO SPEND' : 'AMOUNT TO SELL'} · MAX ${orderLimit.toFixed(2)}</label>
        <div className="amount-field"><span>$</span><input id="trade-amount" disabled={locked} type="number" min="0" max={orderLimit} step="0.01" value={dollars} onChange={(event) => { setDollars(Math.max(0, Math.min(orderLimit, Number(event.target.value)))); setQuote(null); }} /><small>USDC</small></div>
        {!locked && orderLimit > 0 && (
          <div className="amount-presets" role="group" aria-label="Quick amounts">
            {([['25%', 0.25], ['50%', 0.5], ['Max', 1]] as const).map(([label, fraction]) => {
              const value = Number((orderLimit * fraction).toFixed(2));
              return <button type="button" key={label} className={dollars === value ? 'active' : ''} onClick={() => { setDollars(value); setQuote(null); }}>{label}</button>;
            })}
          </div>
        )}

        <div className="route-preview">
          <div><span>PAY</span><strong>{side === 'buy' ? `$${dollars.toFixed(2)}` : `≈ $${dollars.toFixed(2)}`} {inputAsset.symbol}</strong></div>
          <b aria-hidden="true">→</b>
          <div><span>RECEIVE</span><strong>{quote?.outAmount ? `${formatAtomicAmount(quote.outAmount, outputAsset.decimals)} ${outputAsset.symbol}` : `${outputAsset.symbol} at live price`}</strong></div>
        </div>

        {quote && (
          <div className="quote-details">
            <span>PRICE IMPACT <strong>{quote.priceImpactPct ?? '—'}</strong></span>
            <span>ROUTE <strong>{quote.routePlan?.map((leg) => leg.venue).filter(Boolean).join(' → ') || 'BEST AVAILABLE'}</strong></span>
          </div>
        )}

        {message && <p className={`trade-message ${status}`} role="status">{message}</p>}

        <div className="modal-actions">
          {!quote?.transaction && <button className="live-quote-button" type="button" onClick={() => void requestQuote()} disabled={status === 'quoting'}>{status === 'quoting' ? 'LOADING…' : 'PREVIEW'}</button>}
          {quote?.transaction && <button className="live-quote-button" type="button" onClick={executeTrade} disabled={status === 'signing'}>{status === 'signing' ? 'CHECK WALLET…' : secondsLeft !== null ? `APPROVE IN WALLET · ${secondsLeft}s` : 'APPROVE IN WALLET'}</button>}
          {quote && !walletAddress && <button className="connect-modal-button" type="button" onClick={onConnect}>CONNECT WALLET</button>}
        </div>

        <p className="legal-note">Tokenized stocks, not brokerage shares. You approve every transaction.</p>
      </section>
    </div>
  );
}
