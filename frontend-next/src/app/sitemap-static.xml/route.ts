import { staticPaths, urlset, xmlResponse } from '@/lib/sitemap';

export function GET() {
  return xmlResponse(urlset(staticPaths.map(path => ({ path }))));
}
