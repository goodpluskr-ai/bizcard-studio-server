const express = require("express");
const { issueAdminToken } = require("../lib/adminAuth");

const router = express.Router();

// 관리자 로그인 — 비밀번호가 맞으면 서명된 토큰을 내려줍니다.
// 프론트엔드는 이 토큰을 저장해뒀다가, 관리자 API를 부를 때마다
// "Authorization: Bearer <토큰>" 헤더에 실어 보내면 됩니다.
router.post("/login", (req, res) => {
  const { password } = req.body || {};
  const correctPassword = process.env.ADMIN_PASSWORD;
  if (!correctPassword) {
    return res.status(503).json({ error: "서버에 ADMIN_PASSWORD 환경변수가 설정 안 됐습니다." });
  }
  if (password !== correctPassword) {
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  }
  const token = issueAdminToken("admin");
  res.json({ token });
});

module.exports = router;
