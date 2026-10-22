# DokiTruyen Next.js frontend

Frontend mới dùng Next.js App Router và TypeScript. Backend ASP.NET Core hiện hữu được giữ nguyên.

## Cài dependencies

```powershell
npm install
```

## Chạy phát triển

Mặc định API proxy trỏ đến `http://localhost:5080`. Có thể đặt `API_BASE_URL` trong môi trường trước khi chạy Next.js.

```powershell
npm run dev
```

Các route/components sẽ được port từng bước từ `../frontend/src/app`. Các stylesheet Angular gốc hiện được giữ bản sao trong `styles/` để tái sử dụng trong quá trình chuyển giao diện.
