# DokiTruyen — Next.js Fullstack

Tài liệu SEO tự động, sitemap, schema và kiểm tra Core Web Vitals: [SEO.md](SEO.md).

Ứng dụng đọc truyện tranh trực tuyến phát triển bằng **Next.js (App Router)**, tích hợp Neon PostgreSQL cho dữ liệu, cache và hàng đợi nền; cache RAM phục vụ các yêu cầu lặp lại. Không phụ thuộc Redis hoặc backend ngoài.

## Tính năng chính

- **Nguồn truyện đa dạng**: Tích hợp MangaDex và TruyenGG; hỗ trợ tìm kiếm, lọc thể loại, trạng thái, phân trang kết hợp.
- **Đọc truyện**: Đọc ảnh chương truyện trực tiếp, điều hướng chương trước/sau, danh sách chương phân trang và đồng bộ chương giữa các nguồn.
- **Tài khoản & Thư viện**: Đăng ký, đăng nhập JWT, hỗ trợ Google OAuth, theo dõi truyện, lịch sử đọc truyện và đánh giá.
- **Giao diện hiện đại**: Hỗ trợ giao diện tối/sáng, responsive trên máy tính và thiết bị di động.

## Cấu trúc dự án

```text
dokiv2/
├── frontend-next/     # Mã nguồn ứng dụng Next.js (App Router, API routes, components)
├── tests/             # Bộ kiểm thử tích hợp (Node.js test scripts)
├── state/             # Dữ liệu ảnh xem trước
├── .env               # Cấu hình biến môi trường
└── README.md
```

## Chạy phát triển (Local)

Yêu cầu Node.js 20 trở lên.

1. Chuyển vào thư mục Next.js:
   ```bash
   cd frontend-next
   ```

2. Cài đặt các gói phụ thuộc:
   ```bash
   npm install
   ```

3. Cấu hình biến môi trường trong file `.env` hoặc `.env.local` (tham khảo `.env.example`).

4. Khởi chạy server phát triển:
   ```bash
   npm run dev
   ```
   Mở trình duyệt tại [http://localhost:3000](http://localhost:3000).

## Kiểm thử

Chạy các bài kiểm thử từ thư mục gốc của repository:

```bash
node --experimental-strip-types tests/next-catalog.mjs
node --experimental-strip-types tests/truyengg-catalog.mjs
node --experimental-strip-types tests/chapter-source-sync.mjs
```
