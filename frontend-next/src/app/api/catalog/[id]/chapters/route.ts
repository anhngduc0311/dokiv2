import { NextResponse } from 'next/server';
import { getMangaChapters } from '@/lib/catalog-service';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const ascending = searchParams.get('ascending') === 'true';
  const language = searchParams.get('language') === 'en' ? 'en' : 'vi';

  try {
    const data = await getMangaChapters(id, page, ascending, language);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Chapter feed unavailable', id, error);
    return NextResponse.json({ message: 'Chưa tải được danh sách chương. Vui lòng thử lại.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
