import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'HeyStockers · Stock SocialFi on Solana',
  description: 'Publish stock theses, build wallet reputation, and trade tokenized stocks with self-custody on Solana.',
  icons: {
    icon: [
      { url: '/favicon-mark.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'HEYSTOCKERS',
    description: 'Stock theses, wallet reputation, and self-custody execution in one social network.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HeyStockers stock SocialFi network' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HEYSTOCKERS',
    description: 'Stock SocialFi with self-custody execution on Solana.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f6f8fb',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
