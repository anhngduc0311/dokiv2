# DokiTruyen Next.js

Ứng dụng Next.js App Router dùng PostgreSQL cho dữ liệu, cache và queue. Có thể đặt `REDIS_URL` để web và worker dùng chung cache catalog còn hạn. Cache RAM và PostgreSQL tiếp tục phục vụ khi Redis không khả dụng.

## Cache và worker trên cPanel

`DATABASE_URL` là cấu hình bắt buộc. Các bảng `AppCache`, `BackgroundJobs`, `WorkerLeases` được tạo tự động. Catalog được giữ tươi 5 phút và được giữ thêm tối đa 24 giờ để phục vụ trong lúc worker làm mới. Cache thông thường vẫn tuân thủ TTL; mỗi giá trị bị giới hạn 2 MiB và cache RAM bị giới hạn 24 MiB.

Build bằng `npm run build:standalone`; bản build gồm `worker.cjs`. Chạy một lần trước khi mở web:

```sh
node --env-file=.env worker.cjs --warm
```

Thiết lập cron mỗi phút, dùng đường dẫn tuyệt đối tới Node.js của môi trường cPanel:

```sh
cd /home/CPANEL_USER/dokitruyen/release-pg && /home/CPANEL_USER/nodevenv/dokitruyen/24/bin/node --max-old-space-size=160 --env-file=.env worker.cjs >> /home/CPANEL_USER/dokitruyen/worker.log 2>&1
```

Worker có lease chống chạy chồng, job được nhận nguyên tử bằng `SKIP LOCKED`, có retry tối đa 5 lần với backoff, và có thể nhận lại job khi lease hết hạn. Tác vụ tải nguồn cần an toàn khi chạy lại. Không dùng session advisory lock hoặc LISTEN trên kết nối pooler. Worker dọn cache hết hạn và job hoàn tất cũ theo từng lô. Chỉ lưu JSON/metadata/HTML nhỏ trong cache; không lưu ảnh hoặc video.

`npm run package:cpanel` tạo gói `release-pg` riêng để giữ bản triển khai cũ làm phương án khôi phục. Trước đó cần cài Linux sharp vào `.next/linux-runtime` bằng `npm install --prefix .next/linux-runtime --os=linux --cpu=x64 --libc=glibc --ignore-scripts --no-audit --no-fund sharp@<phiên-bản-sharp-đang-dùng>`.

Chuyển database bằng `scripts/migrate-database.mjs` với `SOURCE_DATABASE_URL` và `TARGET_DATABASE_URL` trong file môi trường riêng; database đích phải trống và ứng dụng phải dừng ghi. Script giữ nguyên ID, dữ liệu, ràng buộc và index, rồi đối chiếu số hàng và checksum từng bảng. Không chỉnh sửa database nguồn.

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

## Bổ sung chương TruyenGG cho truyện MangaDex

Khi mở danh sách chương tiếng Việt của truyện MangaDex, ứng dụng tìm bộ tương ứng trên TruyenGG bằng tên chính/tên khác, kiểm tra thông tin tác giả và quốc gia khi có. Nếu chỉ có một bộ khớp rõ ràng, ứng dụng ghi liên kết vào bảng MangaChapterSources và bổ sung số chương còn thiếu. Các chương MangaDex đã có giữ nguyên ID và được ưu tiên ở số chương trùng nhau; chương bổ sung có nhãn TruyenGG.

ID chương bổ sung được lưu riêng trong CatalogSourceRefs, giữ nguyên mangaId MangaDex để theo dõi, lịch sử và đường dẫn về truyện vẫn thống nhất. Điều hướng đọc dùng cùng danh sách đã ghép nên chuyển được giữa hai nguồn. Nguồn bổ sung tạm lỗi hoặc kết quả ghép mơ hồ sẽ giữ danh sách MangaDex hiện có; cache danh sách ghép hết hạn sau 5 phút. Chương tiếng Anh không được trộn với chương tiếng Việt.

Kiểm thử bổ sung: `node --experimental-strip-types tests/chapter-source-sync.mjs`.
