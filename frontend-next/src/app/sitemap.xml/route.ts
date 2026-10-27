import { absoluteUrl } from '@/lib/seo';
import { sitemapRows, SITEMAP_SIZE, xmlEscape, xmlResponse, sitemapUnavailable } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const rows = await sitemapRows();
    const paths = ['/sitemap-static.xml', ...Array.from({ length: Math.ceil(rows.length / SITEMAP_SIZE) }, (_, i) => `/sitemaps/${i}.xml`)];
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<sitemap><loc>${xmlEscape(absoluteUrl(path))}</loc></sitemap>`).join('')}</sitemapindex>`);
  } catch (error) { return sitemapUnavailable(error); }
}
