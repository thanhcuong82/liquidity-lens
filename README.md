# LiquidityLens — Vùng thanh khoản cho mọi coin trên Binance

Web app (PWA) chạy trên **máy tính và điện thoại**. Nhập mã coin bất kỳ (ZEC, BTC, SOL…) → app tải dữ liệu nến từ Binance, tự động tìm và vẽ các **vùng thanh khoản**, đánh dấu **cú quét (liquidity sweep)**, và đưa ra nhận định bằng tiếng Việt.

> Công cụ phân tích tự động trên dữ liệu công khai. Không phải khuyến nghị đầu tư.

## Tính năng
- Tìm mọi cặp coin trên Binance Spot (gõ `zec` → tự hiểu `ZECUSDT`).
- Biểu đồ nến 15m / 1h / 4h / 1D / 1W, cập nhật **trực tiếp** qua WebSocket.
- Tự động phát hiện:
  - Đỉnh / đáy swing (fractal), trạng thái **còn nguyên / đã bị quét / đã bị phá**
  - **Đỉnh bằng / đáy bằng** (equal highs/lows)
  - Đỉnh/đáy **hôm qua** (PDH/PDL) và **tuần trước** (PWH/PWL)
  - Số tròn tâm lý
  - Gộp các mức gần nhau thành **vùng**, chấm **độ mạnh**, tính **khoảng cách %** tới giá
- Mũi tên "quét" trên chart tại nến râu xuyên qua mức rồi đóng cửa quay lại.
- Nhận định tự động: cấu trúc (tăng/giảm/giằng co), vùng mục tiêu trên/dưới, kịch bản và mức vô hiệu.
- Danh sách theo dõi (★), cảnh báo khi giá gần vùng hoặc có cú quét mới (thông báo trình duyệt).
- Tuỳ chỉnh độ nhạy, ngưỡng đỉnh/đáy bằng, ngưỡng gộp vùng.
- Cài ra màn hình chính điện thoại như app thật (PWA). Link chia sẻ dạng `…/#ZECUSDT/4h`.

## Dùng ngay
Sau khi bật GitHub Pages (bên dưới), mở: `https://thanhcuong82.github.io/liquidity-lens/`

- **Điện thoại (iPhone, Safari):** Chia sẻ → *Thêm vào MH chính*.
- **Android (Chrome):** menu ⋮ → *Cài đặt ứng dụng* / *Thêm vào màn hình chính*.
- **Máy tính (Chrome/Edge):** biểu tượng cài đặt trên thanh địa chỉ.

## Bật GitHub Pages (một lần)
Repo → **Settings → Pages** → *Source: Deploy from a branch* → Branch **main**, thư mục **/ (root)** → **Save**. Đợi khoảng 1 phút là có link.

> Repo private: GitHub Pages cho repo private cần gói GitHub Pro. Nếu dùng gói Free, đổi repo sang Public, hoặc chạy trên máy như hướng dẫn dưới.

## Chạy trên máy
Không cần cài đặt hay build. Chỉ cần một web server tĩnh:
```bash
python3 -m http.server 8080
# mở http://localhost:8080
```

## Cấu trúc
```
index.html            Giao diện
css/style.css         Giao diện sáng/tối, responsive
js/analysis.js        Thuật toán vùng thanh khoản (hàm thuần, không phụ thuộc DOM)
js/binance.js         REST + WebSocket Binance (tự chuyển sang data-api.binance.vision nếu bị chặn)
js/app.js             Điều khiển UI, chart, cảnh báo, watchlist
vendor/               TradingView Lightweight Charts 4.2 (Apache-2.0)
sw.js, manifest       PWA
test/                 Kiểm thử thuật toán trên dữ liệu ZEC 4h thật
```

## Thuật toán (tóm tắt)
1. **Swing high/low:** nến có đỉnh (đáy) cao (thấp) nhất trong `N` nến mỗi bên (mặc định 3).
2. **Trạng thái mức:** lần đầu giá chạm qua mức → nếu đóng cửa quay lại = **quét**, nếu đóng cửa vượt hẳn = **phá**; chưa chạm = **còn nguyên**.
3. **Đỉnh/đáy bằng:** các mức còn nguyên chênh nhau ≤ 1% (chỉnh được).
4. **Vùng:** gộp các mức còn nguyên cách nhau ≤ 0.8%; độ mạnh = đỉnh/đáy bằng 3, PWH/PWL 2.5, PDH/PDL 2, swing 1, số tròn 0.5.
5. **Cấu trúc:** so sánh 2 đỉnh và 2 đáy swing gần nhất.

## Kiểm thử
```bash
node --test test/*.test.mjs
```

## Giới hạn
- Dữ liệu Spot của Binance; Futures (open interest, thanh lý) chưa có.
- Cảnh báo chỉ chạy khi app đang mở. Cảnh báo 24/7 khi tắt app cần thêm server (giai đoạn sau).
- Binance chặn một số quốc gia; app tự thử domain dự phòng `data-api.binance.vision`.
