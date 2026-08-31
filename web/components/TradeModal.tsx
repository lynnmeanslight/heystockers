'use client';

import { useMemo, useState } from 'react';
import { apiUrl } from '../lib/api';
import { formatAtomicAmount, toAtomicAmount, TRADE_ASSETS, USDC } from '../lib/assets';

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

export function TradeModal({ open, walletAddress, initialAsset, initialSide = 'buy', initialDollars, assetPrices, maxBuyUsd = 25, sellValues, locked = false, onClose, onConnect, onExecuted }: Props) {
  const [side, setSide] = useState<'buy' | 'sell'>(initialSide);
  const [symbol, setSymbol] = useState(
    TRADE_ASSETS.some((asset) => asset.symbol === initialAsset) ? initialAsset : 'NVDAx',
  );
  const [dollars, setDollars] = useState(() => Math.min(initialDollars ?? 20, initialSide === 'buy' ? maxBuyUsd : (sellValues?.[initialAsset] ?? 0)));
  const [quote, setQuote] = useState<OrderResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'quoting' | 'signing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const asset = useMemo(
    () => TRADE_ASSETS.find((candidate) => candidate.symbol === symbol) ?? TRADE_ASSETS[0],
    [symbol],
  );
  const liveAssetPrice = assetPrices?.[asset.symbol] ?? null;

  if (!open) return null;

  async function requestQuote() {
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

    try {
      const input = side === 'buy' ? USDC : asset;
      const output = side === 'buy' ? asset : USDC;
      const params = new URLSearchParams({
        inputMint: input.mint,
        outputMint: output.mint,
        amount: toAtomicAmount(asset, side, dollars, liveAssetPrice ?? asset.referencePrice),
      });
      if (walletAddress) params.set('userPublicKey', walletAddress);

      const response = await fetch(apiUrl(`/api/trades/order?${params.toString()}`));
      const payload = (await response.json()) as OrderResponse;
      if (!response.ok) throw new Error(payload.error ?? payload.msg ?? 'Live pricing is temporarily unavailable.');

      setQuote(payload);
      setStatus('idle');
      setMessage(walletAddress ? 'Live route ready. Review it before signing.' : 'Live price ready. Connect a wallet to build the transaction.');
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
        setMessage('Refresh the quote after connecting your wallet.');
        setQuote(null);
        setStatus('idle');
        return;
      }

      const provider = window.phantom?.solana ?? window.solana;
      if (!provider) throw new Error('Connect a compatible wallet to sign this transaction.');

      setStatus('signing');
      setMessage('Check the transaction carefully in your wallet.');
      const { VersionedTransaction } = await import('@solana/web3.js');
      const bytes = Uint8Array.from(atob(activeQuote.transaction), (character) => character.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(bytes);
      const result = await provider.signAndSendTransaction(transaction);
      const signature = typeof result === 'string' ? result : result.signature;

      setMessage(`Submitted: ${shortenAddress(signature)}. Verifying trade…`);
      await onExecuted?.(signature);
      setStatus('success');
      setMessage(`Confirmed: ${shortenAddress(signature)}`);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The wallet rejected this trade.');
    }
  }

  const inputAsset = side === 'buy' ? USDC : asset;
  const outputAsset = side === 'buy' ? asset : USDC;
  const orderLimit = Math.min(25, side === 'buy' ? maxBuyUsd : (sellValues?.[asset.symbol] ?? 0));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="trade-modal" role="dialog" aria-modal="true" aria-labelledby="trade-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-topline">
          <span>ORDER</span>
          <button type="button" onClick={onClose} aria-label="Close trade review">×</button>
        </div>
        <div className="trade-title-row">
          <h2 id="trade-title">{side === 'buy' ? 'Buy' : 'Sell'} {asset.symbol}</h2>
          <span className="connection-pill">{walletAddress ? shortenAddress(walletAddress) : 'WALLET NOT CONNECTED'}</span>
        </div>

        <div className="side-switch" aria-label="Trade side">
          <button className={side === 'buy' ? 'selected' : ''} disabled={locked} type="button" onClick={() => { setSide('buy'); setDollars(Math.min(20, maxBuyUsd)); setQuote(null); }}>BUY</button>
          <button className={side === 'sell' ? 'selected' : ''} disabled={locked} type="button" onClick={() => { setSide('sell'); setDollars(Math.min(20, sellValues?.[asset.symbol] ?? 0)); setQuote(null); }}>SELL</button>
        </div>

        <label className="field-label" htmlFor="trade-asset">ASSET</label>
        <select id="trade-asset" disabled={locked} value={symbol} onChange={(event) => { const next = event.target.value; setSymbol(next); if (side === 'sell') setDollars(Math.min(20, sellValues?.[next] ?? 0)); setQuote(null); }}>
          {TRADE_ASSETS.map((candidate) => <option key={candidate.symbol} value={candidate.symbol}>{candidate.symbol} · {candidate.name}</option>)}
        </select>

        <label className="field-label" htmlFor="trade-amount">VALUE · MAX ${orderLimit.toFixed(2)}</label>
        <div className="amount-field"><span>$</span><input id="trade-amount" disabled={locked} type="number" min="0" max={orderLimit} step="0.01" value={dollars} onChange={(event) => { setDollars(Math.max(0, Math.min(orderLimit, Number(event.target.value)))); setQuote(null); }} /><small>USDC</small></div>

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
          {!quote?.transaction && <button className="live-quote-button" type="button" onClick={requestQuote} disabled={status === 'quoting'}>{status === 'quoting' ? 'LOADING…' : 'PREVIEW'}</button>}
          {quote?.transaction && <button className="live-quote-button" type="button" onClick={executeTrade} disabled={status === 'signing'}>{status === 'signing' ? 'CHECK WALLET…' : 'APPROVE IN WALLET'}</button>}
          {quote && !walletAddress && <button className="connect-modal-button" type="button" onClick={onConnect}>CONNECT WALLET</button>}
        </div>

        <p className="legal-note">Tokenized stocks, not brokerage shares. You approve every transaction.</p>
      </section>
    </div>
  );
}
