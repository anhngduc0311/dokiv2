import SearchClient from './client';
import { searchCatalog } from '@/lib/catalog-service';
import { TruyenGgUnavailableError } from '@/lib/truyengg-catalog';
import { toPage } from '@/lib/seo-data';
import { pageMetadata, firstParam, pageNumber, collectionSchema, type SearchParams } from '@/lib/seo';
import { JsonLd } from '@/components/seo/json-ld';

export const dynamic = 'force-dynamic';
type Props = { searchParams: Promise<SearchParams> };
export async function generateMetadata({ searchParams }: Props) {
  const params = await searchParams;
  const q = firstParam(params.q);
  const filtered = Object.keys(params).some(key => key !== 'page' && !!firstParam(params[key]));
  const page = pageNumber(params.page);
  return pageMetadata(q ? `Tìm truyện: ${q}` : `Khám phá truyện tranh${page > 1 ? ` - Trang ${page}` : ''}`, 'Tìm truyện Manga, Manhwa, Manhua theo tên, tác giả, thể loại, quốc gia và trạng thái.', `/tim-truyen-nang-cao${!filtered && page > 1 ? `?page=${page}` : ''}`, undefined, !filtered);
}
export default async function SearchPage({ searchParams }: Props) {
  const p = await searchParams;
  const filters = Object.fromEntries(['source', 'q', 'author', 'genre', 'status', 'country', 'demographic', 'language', 'sort'].map(key => [key, firstParam(p[key])]));
  const page = pageNumber(p.page);
  const result = await searchCatalog({ ...filters, language: filters.language || 'vi', year: Number(firstParam(p.year)) || undefined, page, pageSize: 24 })
    .catch((error: unknown) => {
      if (filters.source !== 'truyengg' || !(error instanceof TruyenGgUnavailableError)) throw error;
      return error;
    });
  if (result instanceof TruyenGgUnavailableError) {
    return <SearchClient key={JSON.stringify(p)} initialData={toPage({ items: [], total: 0, page, pageSize: 24 })} initialError={result.message} />;
  }
  const data = toPage(result);
  return <><JsonLd data={collectionSchema('Khám phá truyện tranh', '/tim-truyen-nang-cao', data.items, (page - 1) * 24)} /><SearchClient key={JSON.stringify(p)} initialData={data} /></>;
}
