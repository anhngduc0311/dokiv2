import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Bundle the pure-JavaScript driver; Windows builds cannot create its external junction.
  transpilePackages: ['pg'],
  images: {
    // cPanel's account quota is smaller than the server-wide free disk space.
    maximumDiskCacheSize: 256 * 1024 * 1024,
    formats: ['image/avif', 'image/webp'],
    localPatterns: [
      // Proxy URLs contain a different encoded source URL for each cover.
      { pathname: '/api/catalog/image-proxy' },
      { pathname: '/**', search: '' },
    ],
    remotePatterns: [{ protocol: 'https', hostname: 'services.f-ck.me', pathname: '/v1/image/**' }],
  },
  async redirects() {
    return [
      { source: '/nettrom', destination: '/', permanent: true },
      { source: '/nettrom/tim-truyen-nang-cao', destination: '/tim-truyen-nang-cao', permanent: true },
      { source: '/nettrom/truyen-tranh/:id', destination: '/truyen-tranh/:id', permanent: true },
      { source: '/nettrom/chuong/:id', destination: '/chuong/:id', permanent: true },
      { source: '/nettrom/theo-doi', destination: '/theo-doi', permanent: true },
      { source: '/nettrom/lich-su', destination: '/lich-su', permanent: true },
    ];
  },
};

export default nextConfig;
