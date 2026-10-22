import { sql, ensureDbInitialized } from './db';
import { cacheGet, cacheSet } from './redis';
import { catalogPagination, searchMangaDex, mangaDexGet, mapMangaDexManga, enrichMangaDexCards } from './mangadex-catalog';
import type { CatalogFilters } from './mangadex-catalog';

const MANGADEX_API = 'https://api.mangadex.org';

export interface ChapterCard {
  id: string;
  mangaId: string;
  title: string;
  number: number;
  language: string;
  publishedAt: string;
  group?: string;
  pagesCount?: number;
  contentType?: 'comic' | 'novel';
}

export interface MangaCard {
  id: string;
  slug?: string;
  title: string;
  alternativeTitle: string;
  author: string;
  cover: string;
  description: string;
  genres: string[];
  status: string;
  country: string;
  demographic: string;
  contentRating?: string;
  year?: number;
  rating?: number;
  views?: number;
  follows?: number;
  updatedAt: string;
  chapters: ChapterCard[];
  totalChapters?: number;
  chaptersCount?: number;
}

export interface CatalogPage {
  items: MangaCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReaderData {
  chapter: ChapterCard;
  manga: MangaCard;
  pages: string[];
  dataSaverPages: string[];
  externalUrl?: string | null;
  navigation: ChapterCard[];
}

export async function rememberManga(m: MangaCard): Promise<void> {
  if (!m || !m.id) return;
  await ensureDbInitialized();

  try {
    await sql`
      INSERT INTO "Mangas" (
        "Id", "Title", "AlternativeTitle", "Author", "Cover", "Description",
        "Genres", "Status", "Country", "Demographic", "Year", "Featured",
        "IsDemo", "Views", "UpdatedAt"
      )
      VALUES (
        ${m.id}, ${m.title}, ${m.alternativeTitle || ''}, ${m.author || ''},
        ${m.cover || '/cover-placeholder.svg'}, ${m.description || ''},
        ${m.genres || []}, ${m.status || 'ongoing'}, ${m.country || 'jp'},
        ${m.demographic || 'shounen'}, ${m.year || 2026}, false, false,
        ${m.views || 0}, ${new Date(m.updatedAt || Date.now()).toISOString()}
      )
      ON CONFLICT ("Id") DO UPDATE SET
        "Title" = EXCLUDED."Title",
        "Cover" = EXCLUDED."Cover",
        "UpdatedAt" = EXCLUDED."UpdatedAt";
    `;
  } catch (err) {
    // Ignore remember errors to not block reading
  }
}

// Crawled database rows are detail snapshots, not the full source catalog.
function mapLocalManga(r: any): MangaCard {
  return {
    id: r.Id, title: r.Title, alternativeTitle: r.AlternativeTitle || '', author: r.Author || 'Chưa rõ',
    cover: r.Cover || '/cover-placeholder.svg', description: r.Description || '', genres: r.Genres || [],
    status: r.Status || 'ongoing', country: r.Country || 'ja', demographic: r.Demographic || '',
    year: r.Year || undefined, views: Number(r.Views || 0), rating: 0, follows: 0,
    updatedAt: r.UpdatedAt ? new Date(r.UpdatedAt).toISOString() : '',
    chaptersCount: Number(r.chapters_count || 0), totalChapters: Number(r.chapters_count || 0),
    chapters: r.recent_chapters || []
  };
}

async function localCatalog(filters: CatalogFilters, genreName = ''): Promise<MangaCard[]> {
  try {
    await ensureDbInitialized();
    const rows = await sql`
      SELECT m.*,
        (SELECT count(*)::int FROM "Chapters" c WHERE c."MangaId" = m."Id") as chapters_count,
        (SELECT coalesce(json_agg(ch), '[]'::json) FROM (
          SELECT c."Id" as id, c."MangaId" as "mangaId", c."Title" as title,
                 c."Number" as number, c."Language" as language, c."PublishedAt" as "publishedAt"
          FROM "Chapters" c WHERE c."MangaId" = m."Id" AND c."PublishedAt" <= CURRENT_TIMESTAMP
          ORDER BY c."Number" DESC LIMIT 3
        ) ch) as recent_chapters
      FROM "Mangas" m
      WHERE m."IsHidden" = false AND m."IsDraft" = false AND m."SourceType" <> 'crawl'
      ORDER BY m."UpdatedAt" DESC, m."Id" ASC;
    `;
    const aliases: Record<string, string> = { jp: 'ja', cn: 'zh', manhwa: 'ko', manhua: 'zh' };
    const countries = (filters.country || '').split(',').map(c => aliases[c] || c);
    const items = rows.map(mapLocalManga).filter(m => {
      const text = (m.title + ' ' + m.alternativeTitle).toLocaleLowerCase('vi');
      return (!filters.q || text.includes(filters.q.toLocaleLowerCase('vi')))
        && (!filters.author || m.author.toLocaleLowerCase('vi').includes(filters.author.toLocaleLowerCase('vi')))
        && (!filters.status || m.status === filters.status)
        && (!filters.country || countries.includes(aliases[m.country] || m.country))
        && (!filters.demographic || m.demographic === filters.demographic)
        && (!filters.year || m.year === filters.year)
        && (!filters.genre || m.genres.some(g => g.toLowerCase() === genreName.toLowerCase()))
        && (filters.language !== 'en' || m.chapters.some(c => c.language === 'en'));
    });
    if (filters.sort === 'title') items.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
    if (filters.sort === 'chapters') items.sort((a, b) => (b.totalChapters || 0) - (a.totalChapters || 0));
    return items;
  } catch {
    // The external catalog remains available if the optional local database is offline.
    return [];
  }
}

export async function searchCatalog(params: CatalogFilters): Promise<CatalogPage> {
  const pagination = catalogPagination(params.page, params.pageSize);
  const filters: CatalogFilters = {
    ...params, q: params.q?.trim() || '', author: params.author?.trim() || '',
    language: params.language === 'en' ? 'en' : 'vi',
    page: pagination.page, pageSize: pagination.pageSize
  };
  const cacheKey = 'catalog:browse:v2:' + JSON.stringify(filters);
  const cached = await cacheGet<CatalogPage>(cacheKey);
  if (cached) return cached;
  let remoteGenre = filters.genre;
  let genreName = '';
  if (filters.genre) {
    const tags = await getTags();
    genreName = tags.find(t => t.id === filters.genre)?.name || filters.genre;
    const remoteTags = await getMangaDexTags();
    remoteGenre = remoteTags.find(t => t.id === filters.genre || t.name.toLowerCase() === genreName.toLowerCase())?.id;
  }
  const local = await localCatalog(filters, genreName);
  const localPage = local.slice(pagination.offset, pagination.offset + pagination.pageSize);
  const remoteOffset = Math.max(0, pagination.offset - local.length);
  const needed = pagination.pageSize - localPage.length;
  const remote = filters.genre && !remoteGenre
    ? { items: [], total: 0 }
    : await searchMangaDex({ ...filters, genre: remoteGenre }, remoteOffset, Math.max(1, needed));
  const result: CatalogPage = {
    items: [...localPage, ...remote.items.slice(0, needed)], total: local.length + remote.total,
    page: pagination.page, pageSize: pagination.pageSize
  };
  await cacheSet(cacheKey, result, 120);
  return result;
}

export async function getHomeCatalog(page = 1, pageSize = 28): Promise<CatalogPage> {
  return searchCatalog({ page, pageSize, language: 'vi', sort: 'latest' });
}

export async function getFeaturedCatalog(limit = 20, page = 1): Promise<CatalogPage> {
  return searchCatalog({ page, pageSize: limit, country: 'ko,zh', language: 'vi', sort: 'hot' });
}

// 4. MANGA DETAIL
export async function getMangaDetail(id: string): Promise<MangaCard | null> {
  const cacheKey = 'manga:detail:source:v2:' + id;
  const cached = await cacheGet<MangaCard>(cacheKey);
  if (cached) return cached;
  let local: any;
  try {
    await ensureDbInitialized();
    const rows = await sql`
      SELECT m.*, (SELECT count(*)::int FROM "Chapters" c WHERE c."MangaId" = m."Id") as chapters_count
      FROM "Mangas" m WHERE m."Id" = ${id} LIMIT 1;
    `;
    local = rows[0];
    if (local?.IsHidden || local?.IsDraft) return null;
    if (local && local.SourceType !== 'crawl') {
      const manga = mapLocalManga(local);
      await cacheSet(cacheKey, manga, 180);
      return manga;
    }
  } catch {
    // Source stories can still be read while the local database is unavailable.
  }
  try {
    const data = await mangaDexGet('/manga/' + encodeURIComponent(id) + '?includes[]=cover_art&includes[]=author&includes[]=artist');
    const manga = mapMangaDexManga(data.data);
    await enrichMangaDexCards([manga]);
    await rememberManga(manga);
    await cacheSet(cacheKey, manga, 300);
    return manga;
  } catch {
    return local ? mapLocalManga(local) : null;
  }
}

// 5. MANGA CHAPTERS
export async function getMangaChapters(
  mangaId: string,
  page: number = 1,
  ascending: boolean = false
): Promise<{ items: ChapterCard[]; total: number; page: number; pageSize: number }> {
  await ensureDbInitialized();

  // Try DB chapters
  const order = ascending ? 'ASC' : 'DESC';
  const rows = await sql`
    SELECT "Id", "MangaId", "Number", "Title", "Language", "PublishedAt", "ContentType", array_length("Pages", 1) as pages_count
    FROM "Chapters"
    WHERE "MangaId" = ${mangaId}
    ORDER BY "Number" DESC
  `;

  if (rows && rows.length > 0) {
    let sorted = rows;
    if (ascending) {
      sorted = [...rows].reverse();
    }
    const items: ChapterCard[] = sorted.map((r: any) => ({
      id: r.Id,
      mangaId: r.MangaId,
      number: Number(r.Number),
      title: r.Title || `Chương ${r.Number}`,
      language: r.Language || 'vi',
      publishedAt: r.PublishedAt ? new Date(r.PublishedAt).toISOString() : new Date().toISOString(),
      group: 'DokiTeam',
      pagesCount: Number(r.pages_count || 0),
      contentType: r.ContentType || 'comic'
    }));

    return {
      items,
      total: items.length,
      page: 1,
      pageSize: 1000
    };
  }

  // Fallback to MangaDex chapter feed
  try {
    const feedUrl = `${MANGADEX_API}/manga/${mangaId}/feed?translatedLanguage[]=vi&order[chapter]=${ascending ? 'asc' : 'desc'}&limit=500`;
    const res = await fetch(feedUrl);
    if (res.ok) {
      const data = await res.json();
      const items: ChapterCard[] = (data.data || []).map((ch: any) => {
        const num = parseFloat(ch.attributes?.chapter || '1');
        return {
          id: ch.id,
          mangaId,
          number: isNaN(num) ? 1 : num,
          title: ch.attributes?.title || `Chương ${ch.attributes?.chapter || 1}`,
          language: 'vi',
          publishedAt: ch.attributes?.publishAt || new Date().toISOString(),
          group: 'MangaDex Group'
        };
      });

      return {
        items,
        total: items.length,
        page: 1,
        pageSize: 500
      };
    }
  } catch {}

  return { items: [], total: 0, page: 1, pageSize: 20 };
}

// 6. CHAPTER READER
export async function getChapterReader(chapterId: string): Promise<ReaderData | null> {
  await ensureDbInitialized();

  // Try DB chapter
  const chapRows = await sql`
    SELECT c.*, m."Title" as manga_title, m."Cover" as manga_cover, m."Author" as manga_author
    FROM "Chapters" c
    JOIN "Mangas" m ON m."Id" = c."MangaId"
    WHERE c."Id" = ${chapterId}
    LIMIT 1;
  `;

  if (chapRows && chapRows.length > 0) {
    const c = chapRows[0];
    const chapter: ChapterCard = {
      id: c.Id,
      mangaId: c.MangaId,
      number: Number(c.Number),
      title: c.Title || `Chương ${c.Number}`,
      language: c.Language || 'vi',
      publishedAt: c.PublishedAt ? new Date(c.PublishedAt).toISOString() : new Date().toISOString(),
      contentType: c.ContentType || 'comic'
    };

    const manga: MangaCard = {
      id: c.MangaId,
      title: c.manga_title,
      alternativeTitle: '',
      author: c.manga_author || 'Chưa rõ',
      cover: c.manga_cover || '/cover-placeholder.svg',
      description: '',
      genres: [],
      status: 'ongoing',
      country: 'jp',
      demographic: 'shounen',
      updatedAt: new Date().toISOString(),
      chapters: []
    };

    const pages: string[] = c.Pages || [];

    // Get sibling chapters for navigation
    const siblings = await sql`
      SELECT "Id", "Number", "Title" FROM "Chapters"
      WHERE "MangaId" = ${c.MangaId}
      ORDER BY "Number" ASC;
    `;

    const nav: ChapterCard[] = siblings.map((s: any) => ({
      id: s.Id,
      mangaId: c.MangaId,
      number: Number(s.Number),
      title: s.Title,
      language: 'vi',
      publishedAt: new Date().toISOString()
    }));

    return {
      chapter,
      manga,
      pages,
      dataSaverPages: pages,
      externalUrl: null,
      navigation: nav
    };
  }

  // Fallback to MangaDex At-Home server
  try {
    const atHomeRes = await fetch(`${MANGADEX_API}/at-home/server/${chapterId}`);
    if (atHomeRes.ok) {
      const atHome = await atHomeRes.json();
      const baseUrl = atHome.baseUrl;
      const hash = atHome.chapter?.hash;
      const files: string[] = atHome.chapter?.data || [];
      const dataSaverFiles: string[] = atHome.chapter?.dataSaver || files;

      const pages = files.map(f => `${baseUrl}/data/${hash}/${f}`);
      const dataSaverPages = dataSaverFiles.map(f => `${baseUrl}/data-saver/${hash}/${f}`);

      // Fetch chapter meta
      const chapMetaRes = await fetch(`${MANGADEX_API}/chapter/${chapterId}?includes[]=manga`);
      let mangaId = '';
      let chTitle = 'Chương';
      let chNum = 1;
      let mangaTitle = 'Truyện';

      if (chapMetaRes.ok) {
        const chapMeta = await chapMetaRes.json();
        const attr = chapMeta.data?.attributes || {};
        const rels = chapMeta.data?.relationships || [];
        const mangaRel = rels.find((r: any) => r.type === 'manga');
        mangaId = mangaRel?.id || '';
        chNum = parseFloat(attr.chapter || '1');
        chTitle = attr.title || `Chương ${attr.chapter || 1}`;
      }

      return {
        chapter: {
          id: chapterId,
          mangaId,
          number: isNaN(chNum) ? 1 : chNum,
          title: chTitle,
          language: 'vi',
          publishedAt: new Date().toISOString()
        },
        manga: {
          id: mangaId,
          title: mangaTitle,
          alternativeTitle: '',
          author: '',
          cover: '/cover-placeholder.svg',
          description: '',
          genres: [],
          status: 'ongoing',
          country: 'jp',
          demographic: 'shounen',
          updatedAt: new Date().toISOString(),
          chapters: []
        },
        pages,
        dataSaverPages,
        externalUrl: null,
        navigation: []
      };
    }
  } catch {}

  return null;
}

// 7. TAGS
async function getMangaDexTags(): Promise<{ id: string; name: string }[]> {
  const key = 'catalog:tags:mangadex:v1';
  const cached = await cacheGet<{ id: string; name: string }[]>(key);
  if (cached) return cached;
  const data = await mangaDexGet('/manga/tag');
  const tags = (data.data || []).map((t: any) => ({
    id: t.id, name: t.attributes?.name?.vi || t.attributes?.name?.en || ''
  })).filter((t: { name: string }) => t.name);
  await cacheSet(key, tags, 3600);
  return tags;
}

export async function getTags(): Promise<{ id: string; name: string }[]> {
  const [remote, local] = await Promise.allSettled([
    getMangaDexTags(),
    (async () => {
      await ensureDbInitialized();
      const rows = await sql`SELECT "Id", "Name" FROM "TaxonomyItems" WHERE "Type" = 'genre' ORDER BY "Name" ASC`;
      return rows.map((r: any) => ({ id: r.Id, name: r.Name as string }));
    })()
  ]);
  const tags = new Map<string, { id: string; name: string }>();
  for (const result of [remote, local]) {
    if (result.status !== 'fulfilled') continue;
    for (const tag of result.value) if (!tags.has(tag.name.toLowerCase())) tags.set(tag.name.toLowerCase(), tag);
  }
  return [...tags.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

// 8. AUTHORS
export async function getAuthorManga(name: string, page: number = 1, pageSize: number = 24): Promise<CatalogPage> {
  return searchCatalog({ author: name, page, pageSize });
}
