import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'xstocks-metadata.backed.fi', pathname: '/logos/tokens/**' }],
  },
};

export default nextConfig;
