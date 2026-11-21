const express = require("express");
const { readCard } = require("../lib/cardReader");

const router = express.Router();

// ⚠️ 비용이 실제로 발생하는 호출입니다(장당 약 9원, gpt-5.4-mini 기준).
// 악용으로 비용이 커지지 않도록 두 겹으로 막습니다 (서버 메모리 기준, 재시작하면 초기화):
//   - 같은 접속(IP)당 1시간에 OCR_LIMIT_PER_IP_HOUR번 (기본 20)
//   - 서버 전체 하루 OCR_LIMIT_PER_DAY번 (기본 300 → 최대 약 2,700원/일)
const PER_IP_HOUR = Number(process.env.OCR_LIMIT_PER_IP_HOUR || 20);
const PER_DAY = Number(process.env.OCR_LIMIT_PER_DAY || 300);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ipHits = new Map(); // ip → [시각...]
let day = new Date().toISOString().slice(0, 10);
let dayCount = 0;
let dayCostUsd = 0;

function allow(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; dayCostUsd = 0; }
  if (dayCount >= PER_DAY) return "오늘 판독 한도를 넘었습니다. 내일 다시 시도해 주세요.";
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (hits.length >= PER_IP_HOUR) return "잠시 후 다시 시도해 주세요. (1시간 판독 횟수 초과)";
  hits.push(now); ipHits.set(ip, hits); dayCount++;
  return null;
}

// 명함 사진(정면으로 펴진 JPEG)을 받아 글자를 판독합니다.
// 요청: { image: "data:image/jpeg;base64,..." }
// 응답: { lines:[{ text, type, unsure, unsureChars, suggestion, roughBox }], model, usage, costUsd, ms }
//  - lines는 "AI 판독값"입니다. 고객이 줄마다 확인·정정해서 확정값으로 저장해야 하며,
//    확정값은 이후 AI가 다시 판독해도 바꾸지 않습니다.
//  - roughBox(0~1 비율)는 대략 위치입니다. 확정 위치로 쓰지 마세요(측정 프로그램이 잼).
router.post("/", async (req, res) => {
  const { image } = req.body || {};
  if (!image || typeof image !== "string") return res.status(400).json({ error: "image는 필수입니다." });
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(image) && !/^[A-Za-z0-9+/=\s]+$/.test(image.slice(0, 200))) {
    return res.status(400).json({ error: "image는 base64 이미지여야 합니다." });
  }
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return res.status(413).json({ error: "사진이 너무 큽니다(최대 8MB)." });
  const blocked = allow(req.ip);
  if (blocked) return res.status(429).json({ error: blocked });

  const result = await readCard(image);
  if (!result.available) return res.status(502).json({ error: result.error || "판독에 실패했습니다." });
  dayCostUsd += result.costUsd;
  console.log(`[ocr-read] ${result.model} ${result.lines.length}줄 ${result.ms}ms $${result.costUsd.toFixed(4)} (오늘 ${dayCount}회 $${dayCostUsd.toFixed(3)})`);
  res.json({ lines: result.lines, model: result.model, usage: result.usage, costUsd: result.costUsd, ms: result.ms });
});

// 배포 확인용 간단한 시험 화면: 브라우저로 /api/ocr-read/test 를 열고 명함 사진을 고르면 결과가 나옵니다.
router.get("/test", (req, res) => {
  res.type("html").send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>명함 판독 시험</title><body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px">
<h2>명함 글자 판독 시험</h2><p>명함 사진을 고르면 서버가 AI로 글자를 읽습니다. (1회 약 9원)</p>
<input type="file" id="f" accept="image/*"><p id="s"></p><pre id="o" style="white-space:pre-wrap;background:#f5f5f5;padding:12px"></pre>
<script>
document.getElementById('f').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  const s = document.getElementById('s'), o = document.getElementById('o');
  s.textContent = '사진 줄이는 중...'; o.textContent = '';
  const img = await createImageBitmap(file); const k = Math.min(1, 2000 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const data = c.toDataURL('image/jpeg', 0.9);
  s.textContent = '판독 중... (5~10초)';
  try {
    const r = await fetch(location.pathname.replace(/\\/test$/, ''), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: data }) });
    const j = await r.json();
    if (!r.ok) { s.textContent = '실패: ' + (j.error || r.status); return; }
    s.textContent = j.model + ' · ' + (j.ms / 1000).toFixed(1) + '초 · $' + j.costUsd.toFixed(4);
    o.textContent = j.lines.map(l => '[' + l.type + '] ' + (l.text || '(판독 안 함)') + (l.unsure ? '  ← 확인 필요' + (l.unsureChars ? ' (' + l.unsureChars + ')' : '') : '') + (l.suggestion ? '  (맞춤법 제안: ' + l.suggestion + ')' : '')).join('\\n');
  } catch (err) { s.textContent = '실패: ' + err.message; }
};
</script></body></html>`);
});

module.exports = router;
