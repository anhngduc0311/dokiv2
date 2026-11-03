import { sitemapRows, sitemapIndex, xmlResponse, sitemapUnavailable } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const rows = await sitemapRows();
    return xmlResponse(sitemapIndex(rows));
  } catch (error) { return sitemapUnavailable(error); }
}
