import type { MangaCard, CatalogPage, ChapterCard } from './catalog-service';
import { get } from 'node:https';

const API = 'https://api.mangadex.org';
const SOURCE_HEADERS = { Accept: 'application/json', 'User-Agent': 'DokiTruyen/1.0 (+https://dokitruyen.com)' };
function sourceApi() {
  const proxy = process.env.MANGADEX_PROXY_URL?.trim().replace(/\/$/, '');
  return proxy ? proxy + '/api' : API;
}
export interface CatalogFilters {
  excludeManhuaManhwa?: boolean;
  source?: string;
  q?: string; author?: string; genre?: string; status?: string; country?: string;
  demographic?: string; language?: string; sort?: string; year?: number;
  page?: number; pageSize?: number;
}

export function catalogPagination(page = 1, pageSize = 24) {
  const size = Number.isFinite(pageSize) ? Math.min(50, Math.max(1, Math.floor(pageSize))) : 24;
  const current = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  return { page: current, pageSize: size, offset: (current - 1) * size };
}

export function mangaDexQuery(filters: CatalogFilters, offset: number, limit: number) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  for (const include of ['cover_art', 'author', 'artist']) query.append('includes[]', include);
  for (const rating of ['safe', 'suggestive']) query.append('contentRating[]', rating);
  query.append('availableTranslatedLanguage[]', filters.language === 'en' ? 'en' : 'vi');
  const orders: Record<string, string> = {
    hot: 'followedCount', rating: 'rating', title: 'title', new: 'createdAt', chapters: 'followedCount'
  };
  const order = orders[filters.sort || ''] || 'latestUploadedChapter';
  query.set('order[' + order + ']', order === 'title' ? 'asc' : 'desc');
  if (filters.q?.trim()) query.set('title', filters.q.trim());
  if (filters.genre) query.append('includedTags[]', filters.genre);
  if (['ongoing', 'completed', 'hiatus', 'cancelled'].includes(filters.status || '')) {
    query.append('status[]', filters.status!);
  }
  for (let country of (filters.country || '').split(',').filter(Boolean)) {
    country = ({ jp: 'ja', cn: 'zh', manhwa: 'ko', manhua: 'zh' } as Record<string, string>)[country] || country;
    if (['ja', 'ko', 'zh', 'zh-hk', 'en'].includes(country)) query.append('originalLanguage[]', country);
  }
  if (filters.excludeManhuaManhwa) {
    for (const language of ['ko', 'zh', 'zh-hk']) query.append('excludedOriginalLanguage[]', language);
  }
  if (['shounen', 'shoujo', 'seinen', 'josei'].includes(filters.demographic || '')) {
    query.append('publicationDemographic[]', filters.demographic!);
  }
  if (filters.year && filters.year >= 1900 && filters.year <= 2100) query.set('year', String(filters.year));
  return query;
}


// Use a fresh Node HTTPS connection if the fetch connection pool is disrupted.
function mangaDexHttps(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = get(sourceApi() + path, {
      agent: false,
      signal: AbortSignal.timeout(6000),
      headers: { ...SOURCE_HEADERS, Connection: 'close' },
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('Nguồn truyện tạm thời không phản hồi. Vui lòng thử lại.'));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) {
          response.destroy(new Error('Source response exceeds the size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

export async function mangaDexGet(path: string): Promise<any> {
  let response: Response;
  try {
    response = await fetch(sourceApi() + path, {
      signal: AbortSignal.timeout(6000),
      headers: SOURCE_HEADERS,
      // Catalog responses are cached by the PostgreSQL cache layer.
      cache: 'no-store',
    });
  } catch {
    return mangaDexHttps(path);
  }
  if (!response.ok) throw new Error('Nguồn truyện tạm thời không phản hồi. Vui lòng thử lại.');
  return response.json();
}

export function mapMangaDexManga(item: any): MangaCard {
  const attr = item.attributes || {};
  const rels = item.relationships || [];
  const altTitles: string[] = (attr.altTitles || []).flatMap((x: any) => Object.values(x || {}));
  const title = attr.title?.vi || attr.altTitles?.find((x: any) => x.vi)?.vi || attr.title?.en || Object.values(attr.title || {})[0] || 'Chưa có tiêu đề';
  const filename = rels.find((r: any) => r.type === 'cover_art')?.attributes?.fileName;
  const coverUrl = filename ? 'https://uploads.mangadex.org/covers/' + item.id + '/' + filename + '.256.jpg' : '';
  const chapter = Number.parseFloat(attr.lastChapter || '0') || 0;
  return {
    id: item.id, title, source: 'mangadex',
    alternativeTitle: altTitles.filter(t => t !== title).slice(0, 3).join(' / '),
    author: [...new Set(rels.filter((r: any) => ['author', 'artist'].includes(r.type)).map((r: any) => r.attributes?.name).filter(Boolean))].join(' / ') || 'Chưa rõ',
    cover: coverUrl ? '/api/catalog/image-proxy?url=' + encodeURIComponent(coverUrl) : '/cover-placeholder.svg',
    description: attr.description?.vi || attr.description?.en || Object.values(attr.description || {})[0] || '',
    genres: (attr.tags || []).map((t: any) => t.attributes?.name?.vi || t.attributes?.name?.en).filter(Boolean),
    status: attr.status || 'ongoing', country: attr.originalLanguage || 'ja',
    demographic: attr.publicationDemographic || '', contentRating: attr.contentRating || 'safe',
    year: attr.year || undefined, rating: 0, follows: 0, views: 0,
    updatedAt: attr.updatedAt || '', totalChapters: chapter, chaptersCount: chapter, chapters: []
  };
}

export async function enrichMangaDexCards(items: MangaCard[], language = 'vi') {
  if (!items.length) return;
  await Promise.allSettled([
    (async () => {
      const q = new URLSearchParams();
      items.forEach(m => q.append('manga[]', m.id));
      const data = await mangaDexGet('/statistics/manga?' + q);
      for (const manga of items) {
        const stats = data.statistics?.[manga.id];
        manga.rating = Number(stats?.rating?.bayesian ?? stats?.rating?.average ?? 0);
        manga.follows = Number(stats?.follows || 0);
      }
    })(),
    (async () => {
      const q = new URLSearchParams({ limit: '20', 'translatedLanguage[]': language === 'en' ? 'en' : 'vi',
        'order[readableAt]': 'desc', includeExternalUrl: '0', includeEmptyPages: '0', includeFuturePublishAt: '0' });
      q.append('contentRating[]', 'safe'); q.append('contentRating[]', 'suggestive');
      // Query each story's feed so older updates are not lost outside the global latest 100.
      for (let offset = 0; offset < items.length; offset += 5) {
        await Promise.allSettled(items.slice(offset, offset + 5).map(async manga => {
          const data = await mangaDexGet('/manga/' + encodeURIComponent(manga.id) + '/feed?' + q);
          const seen = new Set<string>();
          manga.chapters = (data.data || []).filter((c: any) => {
            const key = c.attributes?.chapter ?? c.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).slice(0, 3).map((c: any): ChapterCard => ({
            id: c.id, mangaId: manga.id,
            title: (c.attributes?.chapter ? 'Chương ' + c.attributes.chapter : 'Oneshot') + (c.attributes?.title ? ' · ' + c.attributes.title : ''),
            number: Number.parseFloat(c.attributes?.chapter || '0') || 0,
            language: c.attributes?.translatedLanguage || language,
            publishedAt: c.attributes?.readableAt || c.attributes?.publishAt || c.attributes?.createdAt || '', pagesCount: c.attributes?.pages || 0
          }));
        }));
      }
    })()
  ]);
}

export async function searchMangaDex(filters: CatalogFilters, offset: number, limit: number): Promise<CatalogPage> {
  // MangaDex only exposes the first 10,000 search results. Vietnamese catalog fits within this window.
  const remaining = Math.max(0, 10000 - offset);
  const query = mangaDexQuery(filters, remaining ? offset : 0, remaining ? Math.min(limit, remaining) : 1);
  if (filters.author?.trim()) {
    const authors = await mangaDexGet('/author?' + new URLSearchParams({ name: filters.author.trim(), limit: '100' }));
    const matches = authors.data || [];
    if (!matches.length) return { items: [], total: 0, page: 1, pageSize: limit };
    const exact = matches.filter((a: any) => a.attributes?.name?.toLowerCase() === filters.author!.trim().toLowerCase());
    (exact.length ? exact : matches).forEach((a: any) => query.append('authors[]', a.id));
  }
  const data = await mangaDexGet('/manga?' + query);
  const items = remaining ? (data.data || []).map(mapMangaDexManga) : [];
  await enrichMangaDexCards(items, filters.language);
  return { items, total: Math.min(Number(data.total || 0), 10000), page: 1, pageSize: limit };
}
