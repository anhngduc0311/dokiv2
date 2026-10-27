import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReaderClient from './client';
import { loadReader } from '@/lib/seo-data';
import { pageMetadata, absoluteUrl, breadcrumbSchema } from '@/lib/seo';
import { JsonLd } from '@/components/seo/json-ld';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const data = await loadReader(id);
  if (!data) notFound();
  return pageMetadata(`${data.manga.title} - ${data.chapter.title || `Chương ${data.chapter.number}`}`, `Đọc ${data.manga.title} - ${data.chapter.title || `Chương ${data.chapter.number}`} tiếng Việt. Xem danh sách chương và tiếp tục đọc tại DokiTruyen.`, `/chuong/${encodeURIComponent(id)}`, data.manga.cover);
}
export default async function ChapterPage({ params }: Props) {
  const { id } = await params;
  const data = await loadReader(id);
  if (!data) notFound();
  const path = `/chuong/${encodeURIComponent(id)}`;
  const mangaPath = `/truyen-tranh/${encodeURIComponent(data.manga.id)}`;
  const title = data.chapter.title || `Chương ${data.chapter.number}`;
  const position = data.navigation.findIndex(chapter => chapter.id === id);
  return <>
    <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Chapter', '@id': absoluteUrl(path) + '#chapter', name: title,
      url: absoluteUrl(path), position: data.chapter.number, inLanguage: data.chapter.language,
      isPartOf: { '@type': 'ComicSeries', '@id': absoluteUrl(mangaPath) + '#series', name: data.manga.title, url: absoluteUrl(mangaPath) },
    }} />
    <JsonLd data={breadcrumbSchema([{ name: 'Trang chủ', path: '/' }, { name: data.manga.title, path: mangaPath }, { name: title, path }])} />
    <nav className="reader-seo-nav" aria-label="Đường dẫn và điều hướng chương">
      <Link href="/">Trang chủ</Link><Link href={mangaPath}>{data.manga.title}</Link>
      {position > 0 && <Link prefetch={false} rel="prev" href={`/chuong/${data.navigation[position - 1].id}`}>Chương trước</Link>}
      {position >= 0 && position < data.navigation.length - 1 && <Link prefetch={false} rel="next" href={`/chuong/${data.navigation[position + 1].id}`}>Chương sau</Link>}
    </nav>
    <h1 className="reader-seo-title">{data.manga.title} - {title}</h1>
    <ReaderClient key={id} initialData={data} />
  </>;
}
