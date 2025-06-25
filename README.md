# Tool Play Club

Ứng dụng CLI được viết bằng Node.js, có thể build thành file executable cho Windows, macOS và Linux.

## 🚀 Cách sử dụng

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Chạy thử
```bash
npm start
```

### 3. Build executable

#### Cách 1: Build tự động (Khuyến nghị)
```bash
npm run build
```
hoặc
```bash
node build.js
```

Script sẽ tự động:
- Kiểm tra và cài đặt Bun nếu chưa có
- Cài dependencies
- Build executable
- Test executable

#### Cách 2: Build thủ công với Bun

**Cài Bun trước:**
```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows: vào https://bun.sh để tải
```

**Build:**
```bash
# Build cơ bản
bun build --compile ./index.js --outfile tool-play-club

# Build cho Windows
bun build --compile ./index.js --outfile tool-play-club.exe

# Build với tối ưu hóa
bun build --compile ./index.js --outfile tool-play-club --minify
```

## 📁 Kết quả

Sau khi build xong, file executable sẽ ở trong thư mục `dist/`:

- **Windows**: `dist/tool-play-club.exe`
- **macOS/Linux**: `dist/tool-play-club`

## 🏃‍♂️ Chạy executable

### Windows
```cmd
dist\tool-play-club.exe
```

### macOS/Linux
```bash
./dist/tool-play-club
```

## 📋 Các lệnh khác

```bash
# Build cho platform cụ thể
npm run build:win      # Build cho Windows
npm run build:mac      # Build cho macOS  
npm run build:linux    # Build cho Linux

# Xóa thư mục dist
npm run clean

# Test ứng dụng
npm run test
```

## ⚠️ Lưu ý

- Cần Node.js phiên bản 18 trở lên
- File executable khá nặng (~40-45MB) vì đã bundle tất cả dependencies
- Lần đầu build có thể mất thời gian vì phải tải Bun

## 🐛 Sửa lỗi thường gặp

**Lỗi**: `bun: command not found`
```bash
# Cài lại Bun
curl -fsSL https://bun.sh/install | bash
# Sau đó restart terminal
```

**Lỗi**: Build thất bại
```bash
# Xóa node_modules và cài lại
rm -rf node_modules
npm install
npm run build
```

**Lỗi**: Executable không chạy được (macOS/Linux)
```bash
# Cho phép execute
chmod +x dist/tool-play-club
```