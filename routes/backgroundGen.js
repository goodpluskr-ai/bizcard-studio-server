const express = require("express");
const { generateBackgroundImage } = require("../lib/replicate");

const router = express.Router();

// 프론트엔드(domain/generative/backgroundEngine.js)가 부릅니다 — 프롬프트와
// 카드 규격(mm)을 받아서 Flux Schnell로 배경 이미지 1장을 생성합니다.
router.post("/", async (req, res) => {
  const { prompt, widthMm, heightMm } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt는 필수입니다." });
  }
  const result = await generateBackgroundImage(prompt, widthMm || 90, heightMm || 50);
  if (!result.available) {
    return res.status(502).json({ error: result.error || "이미지 생성에 실패했습니다." });
  }
  res.json({ images: result.images, aspectRatio: result.aspectRatio });
});

module.exports = router;
