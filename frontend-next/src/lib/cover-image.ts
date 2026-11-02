const LEGACY_CDN = 'https://services.f-ck.me/v1/image/';
const PROXY = '/api/catalog/image-proxy?url=';

/** Recover stored legacy URLs without depending on the old third-party image CDN. */
export function mangaDexImageSource(value: string): string | null {
  try {
    let source = value;
    if (source.startsWith(LEGACY_CDN)) {
      const encoded = source.slice(LEGACY_CDN.length);
      if (!/^[A-Za-z0-9_-]+={0,2}$/.test(encoded) || encoded.length > 8192) return null;
      source = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    } else if (source.startsWith(PROXY)) {
      source = new URL(source, 'https://dokitruyen.com').searchParams.get('url') || '';
    }
    const uri = new URL(source);
    if (uri.protocol !== 'https:' || uri.username || uri.password || uri.port) return null;
    if (!['mangadex.org', 'uploads.mangadex.org'].includes(uri.hostname)
        && !uri.hostname.endsWith('.mangadex.network')) return null;
    // MangaDex's website redirects /covers; the upload host serves the actual file.
    if (uri.hostname === 'mangadex.org' && uri.pathname.startsWith('/covers/')) {
      uri.hostname = 'uploads.mangadex.org';
    }
    return uri.href;
  } catch {
    return null;
  }
}

export function coverImage(value?: string | null): string {
  if (!value) return '/cover-placeholder.svg';
  const source = mangaDexImageSource(value);
  return source ? PROXY + encodeURIComponent(source) : value;
}
