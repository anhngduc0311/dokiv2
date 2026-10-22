import { sql, ensureDbInitialized } from './db';
import { cacheGet, cacheSet } from './redis';

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

// Helper to safely format cover image
function formatCoverUrl(mangaId: string, fileName?: string): string {
  if (!fileName) return '/cover-placeholder.svg';
  const rawUrl = `https://mangadex.org/covers/${mangaId}/${fileName}.256.jpg`;
  // Use public proxy URL or direct
  const b64 = Buffer.from(rawUrl).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  return `https://services.f-ck.me/v1/image/${b64}`;
}

// Convert MangaDex API object to MangaCard
function mapMangaDexManga(item: any): MangaCard {
  const attr = item.attributes || {};
  const rels = item.relationships || [];
  const id = item.id;

  const altTitlesList: string[] = (attr.altTitles || [])
    .flatMap((x: any) => Object.values(x || {}))
    .filter(Boolean) as string[];

  const titleVi = attr.altTitles?.find((x: any) => x?.vi)?.vi;
  const titleEn = attr.title?.vi || attr.title?.en || Object.values(attr.title || {})[0] || '';
  const displayTitle = titleVi || titleEn || altTitlesList[0] || 'Chưa có tiêu đề';

  const altTitleDisplay = altTitlesList.filter(t => t !== displayTitle).slice(0, 3).join(' / ');

  const coverRel = rels.find((r: any) => r.type === 'cover_art');
  const coverFileName = coverRel?.attributes?.fileName;
  const cover = formatCoverUrl(id, coverFileName);

  const authorRels = rels
    .filter((r: any) => r.type === 'author' || r.type === 'artist')
    .map((r: any) => r.attributes?.name)
    .filter(Boolean);
  const author = Array.from(new Set(authorRels)).join(' / ') || 'Tác giả chưa rõ';

  const desc = attr.description?.vi || attr.description?.en || Object.values(attr.description || {})[0] || '';

  const genres = (attr.tags || [])
    .map((t: any) => t.attributes?.name?.vi || t.attributes?.name?.en)
    .filter(Boolean);

  const lastChap = parseFloat(attr.lastChapter || '0');

  return {
    id,
    title: displayTitle,
    alternativeTitle: altTitleDisplay,
    author,
    cover,
    description: desc,
    genres,
    status: attr.status || 'ongoing',
    country: attr.originalLanguage || 'jp',
    demographic: attr.publicationDemographic || 'shounen',
    contentRating: attr.contentRating || 'safe',
    year: attr.year ? Number(attr.year) : 2026,
    rating: 9.5,
    views: 12000,
    updatedAt: attr.updatedAt || new Date().toISOString(),
    totalChapters: isNaN(lastChap) ? 0 : Math.round(lastChap),
    chaptersCount: isNaN(lastChap) ? 0 : Math.round(lastChap),
    chapters: []
  };
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

// 1. HOME CATALOG
export async function getHomeCatalog(page: number = 1, pageSize: number = 24): Promise<CatalogPage> {
  const cacheKey = `catalog:home:${page}:${pageSize}`;
  const cached = await cacheGet<CatalogPage>(cacheKey);
  if (cached) return cached;

  await ensureDbInitialized();

  // A. Get local custom mangas from DB first
  const offset = (page - 1) * pageSize;
  const localRows = await sql`
    SELECT m.*, (SELECT count(*)::int FROM "Chapters" c WHERE c."MangaId" = m."Id") as chapters_count
    FROM "Mangas" m
    WHERE m."IsHidden" = false AND m."IsDraft" = false
    ORDER BY m."UpdatedAt" DESC
    LIMIT ${pageSize} OFFSET ${offset};
  `;

  const totalLocal = await sql`
    SELECT count(*)::int as total FROM "Mangas" WHERE "IsHidden" = false AND "IsDraft" = false;
  `;

  let localItems: MangaCard[] = localRows.map((r: any) => ({
    id: r.Id,
    title: r.Title,
    alternativeTitle: r.AlternativeTitle || '',
    author: r.Author || 'Chưa rõ',
    cover: r.Cover || '/cover-placeholder.svg',
    description: r.Description || '',
    genres: r.Genres || [],
    status: r.Status || 'ongoing',
    country: r.Country || 'jp',
    demographic: r.Demographic || 'shounen',
    year: r.Year || 2026,
    views: Number(r.Views || 0),
    rating: 9.6,
    updatedAt: r.UpdatedAt ? new Date(r.UpdatedAt).toISOString() : new Date().toISOString(),
    chaptersCount: Number(r.chapters_count || 0),
    totalChapters: Number(r.chapters_count || 0),
    chapters: []
  }));

  // B. If local items are fewer than pageSize, backfill with MangaDex latest updates
  let items = [...localItems];
  let totalCount = Number(totalLocal[0]?.total || 0);

  if (items.length < pageSize) {
    try {
      const needed = pageSize - items.length;
      const mdOffset = Math.max(0, offset - totalCount);
      const res = await fetch(
        `${MANGADEX_API}/manga?limit=${needed}&offset=${mdOffset}&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=vi&order[latestUploadedChapter]=desc`,
        { next: { revalidate: 300 } }
      );

      if (res.ok) {
        const data = await res.json();
        const mdItems: MangaCard[] = (data.data || []).map(mapMangaDexManga);
        const existingIds = new Set(items.map(x => x.id));
        for (const it of mdItems) {
          if (!existingIds.has(it.id)) {
            items.push(it);
            existingIds.add(it.id);
            void rememberManga(it);
          }
        }
        totalCount += Number(data.total || 0);
      }
    } catch (e) {
      // Continue with local items
    }
  }

  const result: CatalogPage = {
    items,
    total: Math.max(totalCount, items.length),
    page,
    pageSize
  };

  await cacheSet(cacheKey, result, 120);
  return result;
}

// 2. FEATURED CATALOG
export async function getFeaturedCatalog(limit: number = 10, page: number = 1): Promise<CatalogPage> {
  const cacheKey = `catalog:featured:${limit}:${page}`;
  const cached = await cacheGet<CatalogPage>(cacheKey);
  if (cached) return cached;

  await ensureDbInitialized();

  // Try DB featured first
  const rows = await sql`
    SELECT m.*, (SELECT count(*)::int FROM "Chapters" c WHERE c."MangaId" = m."Id") as chapters_count
    FROM "Mangas" m
    WHERE (m."Featured" = true OR m."Views" > 500) AND m."IsHidden" = false
    ORDER BY m."Views" DESC, m."UpdatedAt" DESC
    LIMIT ${limit};
  `;

  let items: MangaCard[] = rows.map((r: any) => ({
    id: r.Id,
    title: r.Title,
    alternativeTitle: r.AlternativeTitle || '',
    author: r.Author || 'Chưa rõ',
    cover: r.Cover || '/cover-placeholder.svg',
    description: r.Description || '',
    genres: r.Genres || [],
    status: r.Status || 'ongoing',
    country: r.Country || 'jp',
    demographic: r.Demographic || 'shounen',
    year: r.Year || 2026,
    views: Number(r.Views || 0),
    rating: 9.8,
    updatedAt: r.UpdatedAt ? new Date(r.UpdatedAt).toISOString() : new Date().toISOString(),
    chaptersCount: Number(r.chapters_count || 0),
    totalChapters: Number(r.chapters_count || 0),
    chapters: []
  }));

  if (items.length < limit) {
    try {
      const res = await fetch(
        `${MANGADEX_API}/manga?limit=${limit}&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=vi&order[followedCount]=desc`,
        { next: { revalidate: 600 } }
      );
      if (res.ok) {
        const data = await res.json();
        const mdItems = (data.data || []).map(mapMangaDexManga);
        const existingIds = new Set(items.map(x => x.id));
        for (const it of mdItems) {
          if (!existingIds.has(it.id) && items.length < limit) {
            items.push(it);
            existingIds.add(it.id);
            void rememberManga(it);
          }
        }
      }
    } catch {}
  }

  const result: CatalogPage = {
    items,
    total: items.length,
    page,
    pageSize: limit
  };

  await cacheSet(cacheKey, result, 300);
  return result;
}

// 3. SEARCH CATALOG
export async function searchCatalog(params: {
  q?: string;
  author?: string;
  genre?: string;
  status?: string;
  country?: string;
  demographic?: string;
  language?: string;
  sort?: string;
  year?: number;
  page?: number;
  pageSize?: number;
}): Promise<CatalogPage> {
  const p = Math.max(1, params.page || 1);
  const size = Math.min(50, Math.max(1, params.pageSize || 24));
  const offset = (p - 1) * size;

  await ensureDbInitialized();

  // Search DB
  let queryText = params.q?.trim() || '';
  let authorText = params.author?.trim() || '';

  let dbResults = await sql`
    SELECT m.*, (SELECT count(*)::int FROM "Chapters" c WHERE c."MangaId" = m."Id") as chapters_count
    FROM "Mangas" m
    WHERE m."IsHidden" = false AND m."IsDraft" = false
      AND (${queryText} = '' OR m."Title" ILIKE ${'%' + queryText + '%'} OR m."AlternativeTitle" ILIKE ${'%' + queryText + '%'})
      AND (${authorText} = '' OR m."Author" ILIKE ${'%' + authorText + '%'})
      AND (${params.status || 'all'} = 'all' OR m."Status" = ${params.status || ''})
      AND (${params.country || 'all'} = 'all' OR m."Country" = ${params.country || ''})
    ORDER BY m."UpdatedAt" DESC
    LIMIT ${size} OFFSET ${offset};
  `;

  let items: MangaCard[] = dbResults.map((r: any) => ({
    id: r.Id,
    title: r.Title,
    alternativeTitle: r.AlternativeTitle || '',
    author: r.Author || 'Chưa rõ',
    cover: r.Cover || '/cover-placeholder.svg',
    description: r.Description || '',
    genres: r.Genres || [],
    status: r.Status || 'ongoing',
    country: r.Country || 'jp',
    demographic: r.Demographic || 'shounen',
    year: r.Year || 2026,
    views: Number(r.Views || 0),
    rating: 9.5,
    updatedAt: r.UpdatedAt ? new Date(r.UpdatedAt).toISOString() : new Date().toISOString(),
    chaptersCount: Number(r.chapters_count || 0),
    totalChapters: Number(r.chapters_count || 0),
    chapters: []
  }));

  // Backfill with MangaDex if needed
  if (items.length < size && queryText) {
    try {
      const url = `${MANGADEX_API}/manga?limit=${size}&title=${encodeURIComponent(queryText)}&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=vi`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const mdItems = (data.data || []).map(mapMangaDexManga);
        const existing = new Set(items.map(x => x.id));
        for (const it of mdItems) {
          if (!existing.has(it.id) && items.length < size) {
            items.push(it);
            existing.add(it.id);
            void rememberManga(it);
          }
        }
      }
    } catch {}
  }

  return {
    items,
    total: Math.max(items.length, size * p),
    page: p,
    pageSize: size
  };
}

// 4. MANGA DETAIL
export async function getMangaDetail(id: string): Promise<MangaCard | null> {
  const cacheKey = `manga:detail:${id}`;
  const cached = await cacheGet<MangaCard>(cacheKey);
  if (cached) return cached;

  await ensureDbInitialized();

  // Check DB first
  const rows = await sql`
    SELECT m.*, (SELECT count(*)::int FROM "Chapters" c WHERE c."MangaId" = m."Id") as chapters_count
    FROM "Mangas" m
    WHERE m."Id" = ${id}
    LIMIT 1;
  `;

  if (rows && rows.length > 0) {
    const r = rows[0];
    const m: MangaCard = {
      id: r.Id,
      title: r.Title,
      alternativeTitle: r.AlternativeTitle || '',
      author: r.Author || 'Chưa rõ',
      cover: r.Cover || '/cover-placeholder.svg',
      description: r.Description || '',
      genres: r.Genres || [],
      status: r.Status || 'ongoing',
      country: r.Country || 'jp',
      demographic: r.Demographic || 'shounen',
      year: r.Year || 2026,
      views: Number(r.Views || 0),
      rating: 9.7,
      updatedAt: r.UpdatedAt ? new Date(r.UpdatedAt).toISOString() : new Date().toISOString(),
      chaptersCount: Number(r.chapters_count || 0),
      totalChapters: Number(r.chapters_count || 0),
      chapters: []
    };
    await cacheSet(cacheKey, m, 180);
    return m;
  }

  // Fallback to MangaDex
  try {
    const res = await fetch(`${MANGADEX_API}/manga/${id}?includes[]=cover_art&includes[]=author`);
    if (res.ok) {
      const data = await res.json();
      const m = mapMangaDexManga(data.data);
      await rememberManga(m);
      await cacheSet(cacheKey, m, 300);
      return m;
    }
  } catch {}

  return null;
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
export async function getTags(): Promise<{ id: string; name: string }[]> {
  await ensureDbInitialized();
  const rows = await sql`
    SELECT "Id", "Name" FROM "TaxonomyItems" WHERE "Type" = 'genre' ORDER BY "Name" ASC;
  `;
  return rows.map((r: any) => ({ id: r.Id, name: r.Name }));
}

// 8. AUTHORS
export async function getAuthorManga(name: string, page: number = 1, pageSize: number = 24): Promise<CatalogPage> {
  return searchCatalog({ author: name, page, pageSize });
}
