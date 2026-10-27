import AuthorPage from './[name]/client';
import { pageMetadata } from '@/lib/seo';
import { firstParam, type SearchParams } from '@/lib/seo';
import { redirect } from 'next/navigation';

export const metadata = pageMetadata('Tìm tác giả truyện tranh', 'Tìm kiếm tác giả và khám phá các tác phẩm truyện tranh tại DokiTruyen.', '/tac-gia');

export default async function Authors({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const name = firstParam(query.name).trim();
  if (name) redirect(`/tac-gia/${encodeURIComponent(name)}`);
  return <AuthorPage />;
}
