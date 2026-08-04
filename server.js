require("dotenv").config();
const express = require("express");
const cors = require("cors");

const ordersRouter = require("./routes/orders");
const companiesRouter = require("./routes/companies");
const adminAuthRouter = require("./routes/adminAuth");

const app = express();

// 프론트엔드(React 앱)가 다른 주소에서 이 서버를 부를 수 있게 허용합니다.
// 지금은 전부 허용(*)해두고, 실제 프론트엔드 주소가 정해지면 그 주소만 허용하도록
// 좁히는 게 더 안전합니다(예: origin: "https://your-frontend.com").
app.use(cors());
app.use(express.json({ limit: "5mb" })); // 인쇄파일 SVG 등 큰 값을 받을 수 있게 여유를 둠

// Render는 배포 후 이 주소로 "살아있는지" 확인합니다(헬스체크).
app.get("/", (req, res) => {
  res.json({ ok: true, service: "bizcard-studio-server", time: new Date().toISOString() });
});

app.use("/api/orders", ordersRouter);
app.use("/api/companies", companiesRouter);
app.use("/api/admin", adminAuthRouter);

// 마지막 안전망 — 예상 못한 에러가 나도 서버가 죽지 않고 에러 응답만 내려줍니다.
app.use((err, req, res, next) => {
  console.error("[server] 처리되지 않은 에러:", err);
  res.status(500).json({ error: "서버 내부 오류가 발생했습니다." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] 실행 중 — 포트 ${PORT}`);
});
