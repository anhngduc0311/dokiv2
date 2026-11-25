import { NextResponse } from 'next/server';
import { mangaDexImageSource } from '../../../../lib/cover-image';
import { stripTruyenGgBanner } from '../../../../lib/reader-banners-server';
import { fetchViaRotatingProxy, isRotatingProxyEnabled } from '../../../../lib/rotating-proxy';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requestedUrl = searchParams.get('url');
  const cleanSource = searchParams.get('clean');
  const mangaDexUrl = requestedUrl ? mangaDexImageSource(requestedUrl) : null;
  const targetUrl = mangaDexUrl || requestedUrl;

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return NextResponse.json({ message: 'Địa chỉ ảnh không hợp lệ.' }, { status: 400 });
  }

  try {
    const uri = new URL(targetUrl);
    let referrer = `${uri.protocol}//${uri.host}/`;

    if (
      uri.host.includes('truyengg') ||
      uri.host.includes('hinhhinh') ||
      uri.host.includes('hinhtruyen') ||
      uri.host.includes('truyenvua') ||
      uri.host.includes('tintruyen') ||
      uri.host.includes('blogspot') ||
      uri.host.includes('nettruyen') ||
      uri.host.includes('nettrom')
    ) {
      referrer = 'https://truyenggvn.com/';
    }

    const proxy = process.env.MANGADEX_PROXY_URL?.trim().replace(/\/$/, '');
    const relayImage = proxy && mangaDexUrl;
    const requestHeaders = {
      // The MangaDex image host sends a browser challenge for browser user agents.
      'User-Agent': mangaDexUrl
        ? 'DokiTruyen/1.0 (+https://dokitruyen.com)'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Referer: referrer
    };

    let contentType = 'image/jpeg';
    let imageBuffer: Buffer | null = null;
    let lastStatus = 502;

    try {
      const res = await fetch(relayImage ? proxy + '/image?url=' + encodeURIComponent(targetUrl) : targetUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
        headers: requestHeaders
      });
      lastStatus = res.status;
      if (res.ok) {
        contentType = res.headers.get('content-type') || 'image/jpeg';
        imageBuffer = Buffer.from(await res.arrayBuffer());
      }
    } catch {
      lastStatus = 502;
    }

    if (!imageBuffer && isRotatingProxyEnabled() && (lastStatus === 403 || lastStatus === 429 || lastStatus >= 500)) {
      const proxied = await fetchViaRotatingProxy(targetUrl, {
        headers: requestHeaders,
        timeoutMs: 12000,
        maxBytes: 24 * 1024 * 1024,
      });
      lastStatus = proxied.status;
      if (proxied.ok) {
        contentType = proxied.headers['content-type'] || 'image/jpeg';
        imageBuffer = proxied.body;
      }
    }

    if (!imageBuffer) {
      return new NextResponse(null, { status: lastStatus });
    }

    if (cleanSource === 'truyengg' && !mangaDexUrl) {
      const cleaned = await stripTruyenGgBanner(imageBuffer, contentType);
      return new NextResponse(new Uint8Array(cleaned.buffer), {
        headers: {
          'Content-Type': cleaned.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    return new NextResponse(new Uint8Array(imageBuffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (err: any) {
    return NextResponse.json({ message: 'Lỗi tải ảnh proxy.' }, { status: 502 });
  }
}
