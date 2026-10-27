import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { pageMetadata, SITE_URL, serializeJsonLd } from '@/lib/seo';
const siteFont = Be_Vietnam_Pro({ subsets: ['latin', 'vietnamese'], weight: ['400', '500', '600', '700', '800'], display: 'swap', variable: '--font-site' });
import './globals.scss';
import { StoreProvider } from '../contexts/store-context';
import { AppShell } from '../components/layout/app-shell';
import { WebVitals } from '@/components/seo/web-vitals';

export const metadata: Metadata = {
  ...pageMetadata('Đọc truyện tranh online - Manga, Manhwa, Manhua', 'Đọc truyện tranh tiếng Việt trên DokiTruyen. Khám phá Manga, Manhwa, Manhua, theo dõi truyện yêu thích và các chương mới cập nhật.', '/'),
  metadataBase: new URL(SITE_URL), icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: 'DokiTruyen',
      alternateName: ['Doki Truyện', 'dokitruyen', 'dokitruyen.com', 'DokiTruyện'],
      description: 'Website đọc truyện tranh online miễn phí cập nhật mới nhất mỗi ngày',
      publisher: {
        '@id': `${SITE_URL}/#organization`
      },
      potentialAction: [
        {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/tim-truyen-nang-cao?q={search_term_string}`
          },
          'query-input': 'required name=search_term_string'
        }
      ],
      inLanguage: 'vi-VN'
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'DokiTruyen',
      alternateName: ['Doki Truyện', 'dokitruyen', 'dokitruyen.com'],
      url: `${SITE_URL}/`,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/brand-mark.png`,
        caption: 'DokiTruyen Logo'
      }
    }
  ]
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={siteFont.variable}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      </head>
      <body>
        <WebVitals />
        <StoreProvider>
          <AppShell>{children}</AppShell>
        </StoreProvider>
      </body>
    </html>
  );
}
