import HomeClient from './client';
import { getHomeCatalog } from '@/lib/catalog-service';
import { toPage } from '@/lib/seo-data';
import { pageMetadata, pageNumber, collectionSchema, type SearchParams } from '@/lib/seo';
import { JsonLd } from '@/components/seo/json-ld';

export const dynamic = 'force-dynamic';
type Props = { searchParams: Promise<SearchParams> };
export async function generateMetadata({ searchParams }: Props) {
  const page = pageNumber((await searchParams).page);
  return pageMetadata(`Đọc truyện tranh online${page > 1 ? ` - Trang ${page}` : ''}`, 'Khám phá Manga, Manhwa, Manhua tiếng Việt và các chương truyện mới cập nhật tại DokiTruyen.', page > 1 ? `/?page=${page}` : '/');
}
export default async function Home({ searchParams }: Props) {
  const page = pageNumber((await searchParams).page);
  const data = toPage(await getHomeCatalog(page, 30));
  return <><JsonLd data={collectionSchema('Truyện mới cập nhật', page > 1 ? `/?page=${page}` : '/', data.items, (page - 1) * 30)} /><HomeClient key={page} initialData={data} /></>;
}
