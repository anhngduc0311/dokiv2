import { sitemapRows, SITEMAP_SIZE, urlset, xmlResponse, sitemapUnavailable } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^(0|[1-9]\d*)\.xml$/.test(file)) return new Response('Not found', { status: 404 });
  const index = Number(file.slice(0, -4));
  if (!Number.isSafeInteger(index)) return new Response('Not found', { status: 404 });
  try {
    const rows = await sitemapRows();
    const batch = rows.slice(index * SITEMAP_SIZE, (index + 1) * SITEMAP_SIZE);
    if (!batch.length) return new Response('Not found', { status: 404 });
    return xmlResponse(urlset(batch));
  } catch (error) { return sitemapUnavailable(error); }
}
