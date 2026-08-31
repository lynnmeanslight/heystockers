import Link from 'next/link';

export const metadata = {
  title: 'Terms · HeyStockers',
  description: 'Terms for using HeyStockers.',
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <Link className="legal-brand" href="/">HEYSTOCKERS</Link>
      <p className="legal-kicker">TERMS OF USE · AUGUST 31, 2026</p>
      <h1>Review every trade.</h1>
      <p className="legal-lead">
        HeyStockers provides a non-custodial interface. It is not a broker, exchange, custodian, investment adviser, or
        source of legal, tax, or investment advice.
      </p>

      <section>
        <h2>Eligibility</h2>
        <p>
          You must be at least 18, control the wallet you connect, and be legally permitted to use every asset and
          service available through HeyStockers in your jurisdiction. Do not use the service for unlawful, sanctioned,
          deceptive, manipulative, or regulated activity for which you lack required authorization.
        </p>
      </section>
      <section>
        <h2>Your transactions</h2>
        <p>
          You review and approve each transaction in your wallet. Routes, prices, liquidity, fees, token-account costs,
          and settlement depend on public networks and independent providers. A preview is not a guarantee of execution.
          You are responsible for verifying the asset, amount, destination, and final wallet prompt.
        </p>
      </section>
      <section>
        <h2>Risk</h2>
        <p>
          Tokenized assets can lose value and may carry issuer, liquidity, smart-contract, oracle, regulatory, metadata,
          and market-hours risk. Network congestion or third-party failure can delay or prevent execution. Never trade
          funds you cannot afford to lose.
        </p>
      </section>
      <section>
        <h2>Social features</h2>
        <p>
          Position calls are user-generated opinions, not recommendations. Do not post unlawful content, impersonate
          others, manipulate markets, or misrepresent performance. HeyStockers may restrict abusive access and remove
          off-chain content when reasonably necessary.
        </p>
      </section>
      <section>
        <h2>Availability and responsibility</h2>
        <p>
          The service is provided as available without a promise that it will be uninterrupted or error-free. To the
          extent permitted by law, you accept responsibility for wallet security, transaction approvals, taxes, and
          losses arising from market movement, public networks, or independent services.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Questions may be sent to <a href="mailto:support@heystockers.trade">support@heystockers.trade</a>.</p>
      </section>
      <footer><Link href="/privacy">Privacy</Link><Link href="/">Back to HeyStockers</Link></footer>
    </main>
  );
}
