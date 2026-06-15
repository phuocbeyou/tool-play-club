import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import cors from "cors"; 
import { getLatestSessionStats } from "./src/socket/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// Cổng riêng cho tool-play-club (tránh đụng các bot khác đang chiếm 3000, vd tool-sun-win).
// Có thể override bằng biến môi trường PORT.
const PORT = process.env.PORT || 3001;

app.use(cors()); // Enable CORS
app.use(express.json());

// Serve static HTML files from src/utils/html
app.use("/html", express.static(path.join(__dirname, "src/utils/html")));

// 🔹 API load config theo gameName
app.get("/api/config/:game", (req, res) => {
  const game = req.params.game;
  const configPath = path.join(__dirname, "src/config", `${game}.json`);

  if (!fs.existsSync(configPath)) {
    return res.status(404).json({ error: `Không tìm thấy config cho game: ${game}` });
  }

  try {
    const data = fs.readFileSync(configPath, "utf8");
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: "Không đọc được file config" });
  }
});

// 🔹 API lưu config theo gameName
app.post("/api/config/:game", (req, res) => {
  const game = req.params.game;
  const configPath = path.join(__dirname, "src/config", `${game}.json`);

  try {
    fs.writeFileSync(configPath, JSON.stringify(req.body, null, 2), "utf8");
    res.json({ success: true, message: `Đã lưu config cho ${game}!` });
  } catch (err) {
    res.status(500).json({ error: "Không lưu được file config: " + err.message });
  }
});

// 🔹 API lấy session stats của Tài Xỉu
app.get("/api/even-odd/session-stats", (req, res) => {
  const stats = getLatestSessionStats();
  if (!stats) {
    return res.status(404).json({ error: "Chưa có dữ liệu session. Hãy bắt đầu game trước." });
  }
  res.json(stats);
});

// 🔹 API lấy lịch sử các phiên Tài Xỉu từ stast-even-odd.json
app.get("/api/even-odd/session-history", (req, res) => {
  const statsFilePath = path.join(__dirname, "src/config/stast-even-odd.json");
  const limit = parseInt(req.query.limit) || 50;

  try {
    if (!fs.existsSync(statsFilePath)) return res.json([]);
    const raw = fs.readFileSync(statsFilePath, "utf8").trim();
    if (!raw || raw === "[]") return res.json([]);
    const history = JSON.parse(raw);
    res.json(history.slice(-limit).reverse());
  } catch (err) {
    res.status(500).json({ error: "Không đọc được file stast-even-odd.json: " + err.message });
  }
});

export const startServer = () => {
  return new Promise((resolve) => {
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server API đang chạy tại http://localhost:${PORT}`);
      resolve(true);
    }).on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`ℹ️  Cổng ${PORT} đã bật. API Server sẽ được sử dụng đồng thời.`);
        resolve(false);
      } else {
        console.error('❌ Lỗi Server:', err);
        resolve(false);
      }
    });
  });
};
