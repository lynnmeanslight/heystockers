import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(isProduction
    ? [
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            // Google's s2/favicons endpoint 301s to *.gstatic.com; CSP checks every redirect hop.
            "img-src 'self' data: https://xstocks-metadata.backed.fi https://www.google.com https://*.gstatic.com",
            "connect-src 'self' https://api.heystockers.trade",
            "font-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; '),
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'xstocks-metadata.backed.fi', pathname: '/logos/tokens/**' }],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
