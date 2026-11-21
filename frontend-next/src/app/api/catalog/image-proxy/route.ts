import { NextResponse } from 'next/server';
import { mangaDexImageSource } from '../../../../lib/cover-image';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requestedUrl = searchParams.get('url');
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
    const res = await fetch(relayImage ? proxy + '/image?url=' + encodeURIComponent(targetUrl) : targetUrl, {
      cache: 'no-store',
      headers: {
        // The MangaDex image host sends a browser challenge for browser user agents.
        'User-Agent': mangaDexUrl
          ? 'DokiTruyen/1.0 (+https://dokitruyen.com)'
          : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: referrer
      }
    });

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (err: any) {
    return NextResponse.json({ message: 'Lỗi tải ảnh proxy.' }, { status: 502 });
  }
}
