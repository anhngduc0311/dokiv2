import { NextResponse } from 'next/server';
import { getAuthorManga } from '@/lib/catalog-service';

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '24', 10);

  let decodedName = name || '';
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decodedName);
      if (next === decodedName) break;
      decodedName = next;
    } catch {
      break;
    }
  }
  const data = await getAuthorManga(decodedName.trim(), page, pageSize);
  return NextResponse.json(data);
}
