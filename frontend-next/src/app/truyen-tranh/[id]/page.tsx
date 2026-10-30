import { notFound } from 'next/navigation';
import MangaClient from './client';
import { loadManga, toManga } from '@/lib/seo-data';
import { getMangaChapters } from '@/lib/catalog-service';
import { pageMetadata, plainText, absoluteUrl, breadcrumbSchema } from '@/lib/seo';
import { JsonLd } from '@/components/seo/json-ld';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const manga = await loadManga(id);
  if (!manga) notFound();
  return pageMetadata(`${manga.title} - Đọc truyện tranh`, manga.description || `Đọc ${manga.title}, xem thông tin tác giả và danh sách chương mới nhất tại DokiTruyen.`, `/truyen-tranh/${encodeURIComponent(id)}`, manga.cover);
}
export default async function MangaPage({ params }: Props) {
  const { id } = await params;
  const manga = await loadManga(id);
  if (!manga) notFound();
  let chapterError = '';
  const chapters = await getMangaChapters(id, 1, false, 'vi').catch(error => {
    console.error('Chapter feed unavailable', id, error);
    chapterError = 'Chưa tải được danh sách chương. Vui lòng thử lại.';
    return { items: [], total: 0, page: 1, pageSize: 1 };
  });
  const path = `/truyen-tranh/${encodeURIComponent(id)}`;
  const schema = { '@context': 'https://schema.org', '@type': 'ComicSeries', '@id': absoluteUrl(path) + '#series',
    name: manga.title, alternateName: manga.alternativeTitle || undefined, url: absoluteUrl(path),
    description: plainText(manga.description, 5000), image: absoluteUrl(manga.cover || '/cover-placeholder.svg'),
    author: manga.author && manga.author !== 'Chưa rõ' ? { '@type': 'Person', name: manga.author, url: absoluteUrl(`/tac-gia/${encodeURIComponent(manga.author)}`) } : undefined,
    genre: manga.genres, inLanguage: 'vi',
  };
  return <><JsonLd data={schema} /><JsonLd data={breadcrumbSchema([{ name: 'Trang chủ', path: '/' }, { name: 'Truyện tranh', path: '/tim-truyen-nang-cao' }, { name: manga.title, path }])} />
    <MangaClient key={id} initialManga={toManga(manga)} initialChapterError={chapterError} initialChapters={{ ...chapters, items: chapters.items.map(c => ({ ...c, group: c.group || '' })) }} /></>;
}
