# DokiTruyen Next.js

Ứng dụng Next.js App Router dùng Neon PostgreSQL và Redis/Upstash (tùy chọn), không cần chạy backend C# để dùng catalog.

## Chạy local

Cấu hình DATABASE_URL trong .env.local, sau đó chạy trong thư mục frontend-next:

```powershell
npm install
npm run dev
```

## Nguồn truyện

- MangaDex: duyệt, tìm kiếm và phân trang kho truyện có bản dịch tiếng Việt/tiếng Anh.
- TruyenGG: tải danh sách, tìm tên truyện, thể loại, quốc gia, tình trạng, truyện mới/cập nhật và truyện yêu thích; hỗ trợ chi tiết, danh sách chương, ảnh đọc và điều hướng chương.
- Trang chủ hiển thị cả hai nguồn. Trong trang khám phá, mở bộ lọc Nguồn truyện để xem riêng MangaDex hoặc TruyenGG.
- Các bản từ hai nguồn có ID riêng và có thể trùng tên. Tổng catalog là số bản truyện của các nguồn, không phải số tác phẩm duy nhất.
- TruyenGG không cung cấp các bộ lọc tác giả, năm, đánh giá, số chương hoặc A-Z qua adapter này; các bộ lọc đó dùng MangaDex. Khi chọn riêng TruyenGG, giao diện tắt các lựa chọn không được hỗ trợ.

Đường dẫn TruyenGG được lưu trong bảng CatalogSourceRefs (tự tạo khi chạy) để mở lại link sau khi khởi động lại hoặc chuyển instance. Giữ DATABASE_URL nhất quán giữa các lần chạy. HTML nguồn được cache 5 phút; một nguồn tạm lỗi không chặn nguồn còn lại. Không cần tải toàn bộ ảnh chương vào database.

## Kiểm tra

Chạy từ thư mục gốc repository:

```powershell
node --experimental-strip-types tests/next-catalog.mjs
node --experimental-strip-types tests/truyengg-catalog.mjs
```

Build trong thư mục frontend-next bằng `npm run build`.
