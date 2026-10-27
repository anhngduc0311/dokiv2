import { cache } from 'react';
import { getMangaDetail, getChapterReader, type MangaCard, type CatalogPage } from './catalog-service';
import type { Manga, Page } from '@/types';

const validId = (id: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
export const loadManga = cache((id: string) => validId(id) ? getMangaDetail(id) : Promise.resolve(null));
export const loadReader = cache(async (id: string) => {
  if (!validId(id)) return null;
  const reader = await getChapterReader(id);
  if (!reader || !await loadManga(reader.manga.id)) return null;
  return { ...reader, externalUrl: reader.externalUrl || null, manga: toManga(reader.manga),
    chapter: { ...reader.chapter, group: reader.chapter.group || '' },
    navigation: reader.navigation.map(chapter => ({ ...chapter, group: chapter.group || '' })) };
});

export function toManga(manga: MangaCard): Manga {
  return { ...manga, contentRating: manga.contentRating || 'safe', year: manga.year || null,
    rating: manga.rating || 0, follows: manga.follows || 0,
    chapters: manga.chapters.map(chapter => ({ ...chapter, group: chapter.group || '' })) };
}
export function toPage(data: CatalogPage): Page<Manga> {
  return { ...data, items: data.items.map(toManga) };
}
