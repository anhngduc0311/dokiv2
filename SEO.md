# SEO tự động — DokiTruyen

## Phân tích và thay đổi

Ứng dụng là Next.js 16 App Router full-stack, Neon PostgreSQL, Redis và nguồn MangaDex/TruyenGG. Trước thay đổi, trang chủ, tìm kiếm, tác giả, chi tiết và chương là Client Components, tải nội dung sau mount. Metadata chủ yếu dùng chung từ layout; sitemap tĩnh và API giới hạn 1.000 truyện, không có chương. Các nhóm Googlebot/Bingbot trong robots ghi đè nhóm chung. Splash che nội dung đến sau hydration, font Google tải từ trình duyệt, Google Identity tải trên mọi trang.

Các trang chính hiện có Server Component lấy dữ liệu ban đầu, dùng chung dữ liệu giữa `generateMetadata` và nội dung bằng React `cache` khi phù hợp. Client Components giữ chức năng đọc, tìm kiếm, tài khoản và bình luận. Metadata có title, description, canonical, Open Graph và Twitter theo trang. ID không hợp lệ hoặc không tìm thấy dùng `notFound`; khu vực tài khoản/quản trị được `noindex`. Trang chủ và danh mục không lọc có canonical riêng theo số trang; các tổ hợp tìm kiếm/bộ lọc được `noindex,follow` và canonical về danh mục gốc.

JSON-LD gồm Organization, WebSite, CollectionPage/ItemList, ComicSeries, Chapter và BreadcrumbList. Không tạo số đánh giá hoặc ngày cập nhật giả. Nội dung JSON được escape để ngăn đóng thẻ script. Schema mô tả nội dung, không bảo đảm Google hiển thị rich results.

Breadcrumb, tiêu đề chương và liên kết trước/sau được render trên server. Phân trang danh mục/tác giả là liên kết thật, hỗ trợ mở tab mới. Danh sách chương ban đầu cũng nằm trong HTML. Các bộ lọc tương tác vẫn hoạt động phía trình duyệt. Ngôn ngữ dữ liệu SSR mặc định là tiếng Việt; người dùng có thể đổi ngôn ngữ sau đó.

## Sitemap và robots

- `/sitemap.xml`: sitemap index, cập nhật tự động.
- `/sitemap-static.xml`: các trang công khai cố định.
- `/sitemaps/0.xml`, `/sitemaps/1.xml`, ...: tối đa 5.000 URL/tệp.
- `/api/sitemap.xml`: chuyển hướng về sitemap index.
- `/robots.txt`: quy tắc chung cho mọi bot, cho phép proxy ảnh, chặn API và khu vực riêng.

Sitemap lấy các truyện không ẩn/nháp, chương không khóa đã đến lịch xuất bản, tác giả, và tham chiếu chương nguồn ngoài đã được lưu thuộc truyện công khai. Không crawl toàn bộ nguồn ngoài trong request sitemap. Những truyện/chương nguồn ngoài chưa được khám phá/lưu sẽ được bổ sung khi catalog lưu dữ liệu/tham chiếu. Với dữ liệu nguồn ngoài, lịch xuất bản chỉ có thể xác minh theo dữ liệu nguồn cung cấp; tham chiếu không có timestamp nên không sinh `lastmod` giả.

Snapshot chia sẻ trong tiến trình có TTL 5 phút và gộp các request đồng thời. CDN có thể cache XML 30 phút. Query chỉ đọc, không khởi tạo schema. Khi DB lỗi, sitemap động trả 503, `Retry-After: 300`, `Cache-Control: no-store`; không phát sitemap rỗng giả. `lastmod` dùng timestamp thật nếu có. Mỗi snapshot hiện đọc danh sách URL vào bộ nhớ; catalog rất lớn nên chuyển sang truy vấn phân trang/keyset và sitemap snapshot dùng chung giữa các instance.

Canonical không lấy Host từ request. Đặt `NEXT_PUBLIC_SITE_URL=https://dokitruyen.com` trước khi build/deploy, mặc định cũng là domain này. Khi đổi domain cần build lại. Gửi `/sitemap.xml` trong Google Search Console sau triển khai.

## Core Web Vitals

Font Be Vietnam Pro được self-host qua `next/font`, có `display: swap`. Đã bỏ splash chặn nội dung; Google Identity chỉ tải ở màn hình xác thực. Ảnh thẻ truyện dùng `next/image`, `sizes`, WebP/AVIF, kích thước cố định và lazy loading. Ảnh bìa chi tiết có kích thước và ưu tiên tải cao; ảnh đầu chương có `fetchPriority=high`, ảnh sau lazy load. Ảnh có thể hiển thị trước hydration, giảm thời gian chờ LCP. Prefetch trang chi tiết từ thẻ ảnh không còn tự chạy cho toàn bộ danh sách khi nằm trong viewport.

`WebVitals` dùng `useReportWebVitals`, phát sự kiện `dokitruyen:web-vital` gồm `{id,name,value,delta,rating,path}` để hệ thống analytics có thể tiếp nhận; development có log console. Chưa cấu hình nơi lưu telemetry. Không thu thập query, token hay thông tin tài khoản.

Chưa thể khẳng định đạt Core Web Vitals thực tế từ build. Cần đo PageSpeed/Lighthouse và CrUX/Search Console sau triển khai; đánh giá phân vị 75: LCP ≤ 2,5 giây, INP ≤ 200 ms, CLS ≤ 0,1. Dữ liệu ảnh trang chương hiện chỉ có URL, thiếu kích thước thật nên vẫn có thể dịch chuyển bố cục khi ảnh tải; cần lưu width/height lúc ingest để xử lý triệt để. TTFB còn phụ thuộc DB và API nguồn ngoài; dữ liệu có cache hiện hữu của catalog nhưng SSR phải đợi nguồn khi cache miss.

## Kiểm tra

```powershell
node --experimental-strip-types tests/seo.mjs
npm run build
node frontend-next/node_modules/typescript/bin/tsc --noEmit -p frontend-next/tsconfig.json
```

Bộ `tests/seo.mjs` kiểm tra metadata, escape JSON-LD/XML, chống URL sitemap bị thay bằng Host giả, cache đồng thời, ranh giới phân mảnh, 404/503 và render server của component truyện/chương bằng fixture. Các test catalog, parser TruyenGG, đồng bộ chương, MangaDex reader, khử trùng catalog và reader banners đã chạy thành công. `tests/spotlight.mjs` là test cũ đang trỏ tới thư mục `frontend/` không còn tồn tại; chưa thay đổi trong phạm vi này.

ESLint toàn dự án còn lỗi nền trong mã hiện hữu. So sánh các component được chuyển từ `page.tsx` sang `client.tsx` cho thấy số lỗi không tăng; component phân trang không có lỗi, trang tìm kiếm giảm một lỗi. Các hạn chế lint không ngăn build production và kiểm tra TypeScript.

Kiểm tra HTML khi tắt JavaScript: trang chi tiết có tên, mô tả và liên kết chương; chương có H1, ảnh và liên kết về truyện; các trang có canonical/OG/schema tương ứng. Dùng Schema Markup Validator và Google Rich Results Test; ComicSeries/Chapter có thể hợp lệ ở Schema.org dù không có rich-result chuyên biệt của Google.

Tài liệu tham chiếu: [Next.js metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), [Google sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview), [Google breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb), [Core Web Vitals](https://web.dev/articles/vitals).
