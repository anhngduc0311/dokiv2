import { NextResponse } from 'next/server';
import { getChapterReader } from '@/lib/catalog-service';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getChapterReader(id);

  if (!data) {
    return NextResponse.json({ message: 'Không tìm thấy chương truyện.' }, { status: 404 });
  }

  return NextResponse.json(data);
}
