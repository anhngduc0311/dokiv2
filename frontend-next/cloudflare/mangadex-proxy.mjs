const apiPath = /^\/(?:manga(?:\/tag|\/[0-9a-f-]{36}(?:\/feed)?)?|chapter\/[0-9a-f-]{36}|at-home\/server\/[0-9a-f-]{36}|statistics\/manga|author)$/i;
export function allowedImage(url) {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password
    && (url.hostname === 'uploads.mangadex.org' || url.hostname === 'mangadex.org'
      || url.hostname.endsWith('.mangadex.network'));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return Response.json({ message: 'Method not allowed' }, { status: 405 });
    let target;
    let image = false;
    if (url.pathname.startsWith('/api/') && apiPath.test(url.pathname.slice(4))) {
      target = new URL('https://api.mangadex.org' + url.pathname.slice(4) + url.search);
    } else if (url.pathname === '/image') {
      try { target = new URL(url.searchParams.get('url')); } catch { /* Reject malformed URLs. */ }
      if (!target || !allowedImage(target)) return Response.json({ message: 'Image source not allowed' }, { status: 400 });
      image = true;
    } else {
      return Response.json({ message: 'Not found' }, { status: 404 });
    }
    try {
      const response = await fetch(target, {
        method: request.method,
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
        headers: {
          Accept: image ? 'image/*' : 'application/json',
          'User-Agent': 'DokiTruyen/1.0 (+https://dokitruyen.com)',
          ...(image ? { Referer: 'https://mangadex.org/' } : {}),
        },
        cf: { cacheTtl: image ? 86400 : 30, cacheEverything: true },
      });
      if (response.status >= 300 && response.status < 400) return Response.json({ message: 'Unexpected upstream redirect' }, { status: 502 });
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || (image ? 'application/octet-stream' : 'application/json'),
          'Cache-Control': response.ok ? (image ? 'public, max-age=86400' : 'public, max-age=30') : 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return Response.json({ message: 'Source temporarily unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
