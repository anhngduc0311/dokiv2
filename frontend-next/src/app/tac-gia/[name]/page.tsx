import AuthorClient from './client';
import { getAuthorManga } from '@/lib/catalog-service';
import { toPage } from '@/lib/seo-data';
import { pageMetadata, pageNumber, firstParam, collectionSchema, breadcrumbSchema, type SearchParams } from '@/lib/seo';
import { JsonLd } from '@/components/seo/json-ld';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ name: string }>; searchParams: Promise<SearchParams> };
export async function generateMetadata({ params, searchParams }: Props) {
  const { name } = await params;
  const query = await searchParams;
  const page = pageNumber(query.page);
  return pageMetadata(`Truyện của ${name}${page > 1 ? ` - Trang ${page}` : ''}`, `Khám phá các bộ truyện tranh của tác giả ${name} và các chương mới tại DokiTruyen.`, `/tac-gia/${encodeURIComponent(name)}${page > 1 ? `?page=${page}` : ''}`, undefined, !firstParam(query.sort) || firstParam(query.sort) === 'latest');
}
export default async function AuthorPage({ params, searchParams }: Props) {
  const { name } = await params;
  const page = pageNumber((await searchParams).page);
  const data = toPage(await getAuthorManga(name, page, 24));
  const path = `/tac-gia/${encodeURIComponent(name)}`;
  return <><JsonLd data={collectionSchema(`Truyện của ${name}`, path, data.items, (page - 1) * 24)} />
    <JsonLd data={breadcrumbSchema([{ name: 'Trang chủ', path: '/' }, { name: 'Tác giả', path: '/tac-gia' }, { name, path }])} />
    <AuthorClient key={`${name}:${page}`} initialData={data} /></>;
}
