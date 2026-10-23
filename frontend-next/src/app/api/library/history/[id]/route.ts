import { NextResponse } from 'next/server';
import { sql, ensureDbInitialized } from '@/lib/db';
import { getUserFromRequest } from '@/lib/auth';
import { rememberManga } from '@/lib/catalog-service';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureDbInitialized();
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ message: 'Chưa đăng nhập.' }, { status: 401 });
  }

  // Catalog chapters can come directly from MangaDex or TruyenGG and may not
  // have a local Chapters row yet. Remember enough source metadata to satisfy
  // the library foreign keys before recording the read.
  const payload = await req.json().catch(() => ({}));
  const manga = payload?.manga;
  const chapter = payload?.chapter;
  if (manga?.id && chapter?.id === id) {
    await rememberManga(manga);
    const chapterNumber = Number(chapter.number);
    await sql`
      INSERT INTO "Chapters" ("Id", "MangaId", "Number", "Title", "Language", "Pages", "ContentType")
      VALUES (
        ${id}, ${manga.id}, ${Number.isFinite(chapterNumber) ? chapterNumber : 1},
        ${chapter.title || ''}, ${chapter.language || 'vi'}, ARRAY[]::text[], ${chapter.contentType || 'comic'}
      )
      ON CONFLICT ("Id") DO UPDATE SET
        "Title" = EXCLUDED."Title",
        "Number" = EXCLUDED."Number",
        "Language" = EXCLUDED."Language";
    `;
  }

  const chap = await sql`SELECT "MangaId" FROM "Chapters" WHERE "Id" = ${id} LIMIT 1;`;
  if (!chap || chap.length === 0) {
    return NextResponse.json({ message: 'Chương không tồn tại.' }, { status: 404 });
  }

  const mangaId = chap[0].MangaId;
  await sql`
    INSERT INTO "Histories" ("UserId", "MangaId", "ChapterId", "ReadAt")
    VALUES (${user.id}, ${mangaId}, ${id}, CURRENT_TIMESTAMP)
    ON CONFLICT ("UserId", "MangaId") DO UPDATE SET
      "ChapterId" = EXCLUDED."ChapterId",
      "ReadAt" = EXCLUDED."ReadAt";
  `;

  return new NextResponse(null, { status: 204 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ensureDbInitialized();
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ message: 'Chưa đăng nhập.' }, { status: 401 });
  }

  await sql`
    DELETE FROM "Histories" WHERE "UserId" = ${user.id} AND "MangaId" = ${id};
  `;

  return new NextResponse(null, { status: 204 });
}
