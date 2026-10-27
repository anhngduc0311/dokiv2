import type { Metadata } from 'next';

// Never derive public URLs from request Host / forwarded headers.
export const SITE_URL = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://dokitruyen.com').origin;
export const SITE_NAME = 'DokiTruyen';
export type SearchParams = Record<string, string | string[] | undefined>;
export const firstParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] || '' : value || '';
export const pageNumber = (value: string | string[] | undefined) => Math.min(10000, Math.max(1, Math.floor(Number(firstParam(value))) || 1));
export const absoluteUrl = (path: string) => new URL(path, SITE_URL).href;

export function plainText(value: string, limit = 160) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[#*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function pageMetadata(title: string, description: string, path: string, image = '/brand-mark.png', index = true): Metadata {
  const fullTitle = `${plainText(title, 110)} | ${SITE_NAME}`;
  const summary = plainText(description);
  const url = absoluteUrl(path);
  const cover = absoluteUrl(image || '/brand-mark.png');
  return {
    title: { absolute: fullTitle }, description: summary, alternates: { canonical: url },
    openGraph: { title: fullTitle, description: summary, url, type: 'website', siteName: SITE_NAME, locale: 'vi_VN', images: [{ url: cover, alt: title }] },
    twitter: { card: 'summary_large_image', title: fullTitle, description: summary, images: [cover] },
    robots: { index, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  };
}

export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function breadcrumbSchema(items: { name: string; path: string }[]) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, i) => ({
    '@type': 'ListItem', position: i + 1, name: item.name, item: absoluteUrl(item.path),
  })) };
}

export function collectionSchema(name: string, path: string, items: { id: string; title: string }[], offset = 0) {
  return { '@context': 'https://schema.org', '@type': 'CollectionPage', name, url: absoluteUrl(path), inLanguage: 'vi',
    mainEntity: { '@type': 'ItemList', itemListElement: items.map((item, i) => ({
      '@type': 'ListItem', position: offset + i + 1, name: item.title, url: absoluteUrl(`/truyen-tranh/${encodeURIComponent(item.id)}`),
    })) },
  };
}
