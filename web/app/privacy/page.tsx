import Link from 'next/link';

export const metadata = {
  title: 'Privacy · HeyStockers',
  description: 'How HeyStockers handles wallet and social profile data.',
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <Link className="legal-brand" href="/">HEYSTOCKERS</Link>
      <p className="legal-kicker">PRIVACY POLICY · AUGUST 31, 2026</p>
      <h1>Your wallet stays yours.</h1>
      <p className="legal-lead">
        HeyStockers is a non-custodial interface for tokenized assets and a public, trade-verified social record.
        We do not hold private keys or move assets without a transaction you approve in your wallet.
      </p>

      <section>
        <h2>Data we process</h2>
        <p>
          We process public wallet addresses, supported token balances, usernames, referrals, follows, signals,
          position calls, and wallet signatures used to prove account control. We also process ordinary security data
          such as IP-derived request limits and service logs. We do not request seed phrases or private keys.
        </p>
      </section>
      <section>
        <h2>How we use and share data</h2>
        <p>
          We use this data to show portfolios, route wallet-approved trades, prevent abuse, verify position calls, and
          operate public social features. Public usernames, wallet addresses, position calls, records, and reactions
          can be visible to other users. Infrastructure, blockchain RPC, market-routing, and hosting providers process
          the minimum data needed to deliver those functions. We do not sell personal data.
        </p>
      </section>
      <section>
        <h2>Blockchain data</h2>
        <p>
          Solana transactions are public and cannot be changed or erased by HeyStockers. Deleting your HeyStockers
          account removes the related profile and social data from our service, but it cannot remove transactions or
          information independently retained on a public blockchain or by another party.
        </p>
      </section>
      <section>
        <h2>Retention, deletion, and security</h2>
        <p>
          Account sessions expire automatically. Operational logs are kept only as reasonably needed for reliability,
          security, fraud prevention, and legal obligations. In the mobile app, open People, then choose Delete account
          to remove your profile and social activity. Data is protected in transit with HTTPS and access-controlled
          production systems, but no system can be guaranteed completely secure.
        </p>
      </section>
      <section>
        <h2>Age and changes</h2>
        <p>
          HeyStockers is not intended for children. You must be at least 18 and legally permitted to use tokenized
          assets where you live. We may update this policy as the product or law changes and will revise the date above.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Privacy questions may be sent to <a href="mailto:privacy@heystockers.trade">privacy@heystockers.trade</a>.</p>
      </section>
      <footer><Link href="/terms">Terms</Link><Link href="/">Back to HeyStockers</Link></footer>
    </main>
  );
}
