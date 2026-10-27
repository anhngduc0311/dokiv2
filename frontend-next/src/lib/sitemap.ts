import { sql } from './db';
import { absoluteUrl } from './seo';

export const SITEMAP_SIZE = 5000;
export const xmlEscape = (value: string) => value.replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!);
export const staticPaths = ['/', '/tim-truyen-nang-cao', '/tac-gia'];

type SitemapRow = { path: string; modified: string | null };
let snapshot: { expires: number; rows: SitemapRow[] } | undefined;
let pending: Promise<SitemapRow[]> | undefined;

export async function sitemapRows(): Promise<SitemapRow[]> {
  if (snapshot && snapshot.expires > Date.now()) return snapshot.rows;
  if (pending) return pending;
  pending = readSitemapRows().then(rows => {
    snapshot = { rows, expires: Date.now() + 300_000 };
    return rows;
  }).finally(() => { pending = undefined; });
  return pending;
}

// Read only: crawlers must never initialize or mutate the database.
async function readSitemapRows(): Promise<SitemapRow[]> {
  const rows = await sql`
    SELECT '/truyen-tranh/' || m."Id"::text AS path, m."UpdatedAt" AS modified
    FROM "Mangas" m WHERE m."IsHidden" = false AND m."IsDraft" = false
    UNION ALL
    SELECT '/chuong/' || c."Id"::text AS path, c."PublishedAt" AS modified
    FROM "Chapters" c JOIN "Mangas" m ON m."Id" = c."MangaId"
    WHERE m."IsHidden" = false AND m."IsDraft" = false AND c."IsLocked" = false
      AND c."PublishedAt" <= CURRENT_TIMESTAMP
      AND (c."ScheduledPublishAt" IS NULL OR c."ScheduledPublishAt" <= CURRENT_TIMESTAMP)
    UNION
    SELECT '/tac-gia/' || m."Author" AS path, NULL AS modified
    FROM "Mangas" m WHERE m."IsHidden" = false AND m."IsDraft" = false
      AND m."Author" <> '' AND m."Author" <> 'Chưa rõ'
    ORDER BY path;
  `;
  const refsTable = await sql`SELECT to_regclass('public."CatalogSourceRefs"') AS name`;
  if (refsTable[0]?.name) {
    const refs = await sql`
      SELECT '/chuong/' || r."Id"::text AS path, NULL AS modified
      FROM "CatalogSourceRefs" r JOIN "Mangas" m ON m."Id" = r."MangaId"
      WHERE r."Kind" = 'chapter' AND m."IsHidden" = false AND m."IsDraft" = false;
    `;
    rows.push(...refs);
  }
  return [...new Map(rows.map(row => {
    const path = String(row.path);
    const encoded = path.startsWith('/tac-gia/') ? '/tac-gia/' + encodeURIComponent(path.slice('/tac-gia/'.length)) : path;
    return [encoded, { path: encoded, modified: row.modified as string | null }];
  })).values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function urlset(rows: { path: string; modified?: string | null }[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.map(row => {
    const date = row.modified ? new Date(row.modified) : null;
    const lastmod = date && Number.isFinite(date.getTime()) ? `<lastmod>${date.toISOString()}</lastmod>` : '';
    return `<url><loc>${xmlEscape(absoluteUrl(row.path))}</loc>${lastmod}</url>`;
  }).join('')}</urlset>`;
}

export function xmlResponse(xml: string) {
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=1800' } });
}
export function sitemapUnavailable(error: unknown) {
  console.error('[sitemap] Could not read catalog', error instanceof Error ? error.name : 'UnknownError');
  return new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '300' } });
}
