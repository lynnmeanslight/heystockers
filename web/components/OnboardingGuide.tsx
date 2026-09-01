'use client';

import { useEffect, useRef, useState } from 'react';

const STEPS = [
  { title: 'Connect your wallet.', body: 'HeyStockers reads only your USDC and supported stock balances. Nothing moves until you approve a transaction.' },
  { title: 'Choose a stock.', body: 'Browse the highest-volume Solana stocks. Buy with USDC, or sell a stock already held in your wallet.' },
  { title: 'Preview, then approve.', body: 'Preview gets a live route. Your wallet shows the final transaction; closing or rejecting it changes nothing.' },
  { title: 'Publish a verified call.', body: 'Set a target, deadline and reason. Your call becomes public only after its matching trade is verified onchain.' },
] as const;

type Props = { open: boolean; onClose(): void };

export function OnboardingGuide({ open, onClose }: Props) {
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setStep(0);
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  function close() {
    setStep(0);
    onClose();
  }
  return (
    <div className="guide-backdrop" role="presentation">
      <section ref={dialogRef} tabIndex={-1} className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <div className="guide-topline"><span>GUIDE · {step + 1}/{STEPS.length}</span><button type="button" onClick={close} aria-label="Close user guide">×</button></div>
        <div className="guide-progress" aria-hidden="true">{STEPS.map((_, index) => <i className={index <= step ? 'active' : ''} key={index} />)}</div>
        <h2 id="guide-title">{current.title}</h2>
        <p>{current.body}</p>
        <div className="guide-actions">
          {step > 0 && <button type="button" className="guide-back" onClick={() => setStep((value) => value - 1)}>Back</button>}
          <button type="button" className="guide-next" onClick={() => last ? close() : setStep((value) => value + 1)}>{last ? 'Start trading' : 'Next'}</button>
        </div>
      </section>
    </div>
  );
}
