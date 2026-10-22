import { NextResponse } from 'next/server';
import { sql, ensureDbInitialized } from '@/lib/db';
import { verifyPassword, createSession } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    await ensureDbInitialized();
    const body = await req.json();
    const email = (body.Email || body.email || '').trim().toLowerCase();
    const password = body.Password || body.password || '';

    if (!email || !password) {
      return NextResponse.json({ message: 'Vui lòng nhập email và mật khẩu.' }, { status: 400 });
    }

    const rows = await sql`
      SELECT "Id", "Email", "Name", "Role", "Coins", "IsBanned", "PasswordHash", "PasswordVersion"
      FROM "Users"
      WHERE "Email" = ${email} OR ("Email" = 'admin' AND ${email} = 'admin')
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) {
      return NextResponse.json({ message: 'Email hoặc mật khẩu không đúng.' }, { status: 401 });
    }

    const u = rows[0];

    if (u.IsBanned) {
      return NextResponse.json({ message: 'Tài khoản của bạn đã bị tạm khóa.' }, { status: 403 });
    }

    const match = await verifyPassword(password, u.PasswordHash);
    if (!match) {
      return NextResponse.json({ message: 'Email hoặc mật khẩu không đúng.' }, { status: 401 });
    }

    const session = createSession({
      id: u.Id,
      email: u.Email,
      name: u.Name,
      role: u.Role,
      coins: Number(u.Coins || 0),
      isBanned: u.IsBanned,
      passwordHash: u.PasswordHash,
      passwordVersion: Number(u.PasswordVersion || 0)
    });

    return NextResponse.json(session);
  } catch (err: any) {
    return NextResponse.json({ message: err.message || 'Lỗi đăng nhập.' }, { status: 500 });
  }
}
