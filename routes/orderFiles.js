// 2026-11-25 — 주문 원본 파일 저장소 (Supabase Storage, 비공개 버킷)
// 왜: 주문 알림 메일(EmailJS)은 첨부가 1개뿐이고 크기 제한도 있어서, 특별회원 여러 건·큰 PDF 원본을
// 메일로 다 보낼 수 없음. → 브라우저가 파일을 저장소에 직접 올리고(서버를 거치지 않아 용량 걱정 적음),
// 메일에는 내려받기 링크만 넣음.
//
//  POST /api/order-files/upload-url   { fileName, contentType, size } → { path, signedUrl, token }
//       브라우저는 signedUrl로 파일을 직접 올림 (한 번만 쓸 수 있는 올리기 주소)
//  POST /api/order-files/download-links { paths: [...] } → { links: [{ path, url }] }  (30일 유효)
//
// 버킷은 처음 쓸 때 서버가 비공개로 자동 생성(service_role 키라 가능). 공개 주소는 없고,
// 서명된 링크로만 내려받을 수 있음.
const express = require("express");
const crypto = require("crypto");
const { supabase } = require("../lib/supabase");

const router = express.Router();
const BUCKET = "order-files";
const MAX_BYTES = 50 * 1024 * 1024; // 파일 하나 50MB
const LINK_TTL_SEC = 30 * 24 * 3600; // 내려받기 링크 30일
const OK_TYPE = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i;

// 아무나 무한히 올리지 못하게: IP마다 1시간에 120개
const ipHits = new Map();
function allow(ip) {
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (hits.length >= 120) return false;
  hits.push(now); ipHits.set(ip, hits);
  return true;
}

let bucketReady = null;
function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { data } = await supabase.storage.getBucket(BUCKET);
      if (data) return;
      const { error } = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
      if (error && !/already exists/i.test(error.message)) throw error;
    })().catch((e) => { bucketReady = null; throw e; });
  }
  return bucketReady;
}

// 파일 이름은 한글 그대로 두면 저장소 경로에서 문제가 될 수 있어, 경로에는 영문·숫자만 쓰고 원래 이름은 프론트가 따로 보관
function safeExt(name, type) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name || "");
  if (m) return m[1].toLowerCase();
  return /pdf/i.test(type || "") ? "pdf" : /png/i.test(type || "") ? "png" : "jpg";
}

router.post("/upload-url", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "저장소가 아직 연결 안 됐어요(환경변수 확인 필요)." });
  if (!allow(req.ip)) return res.status(429).json({ error: "잠시 후 다시 시도해 주세요." });
  const { fileName, contentType, size } = req.body || {};
  if (!OK_TYPE.test(contentType || "")) return res.status(400).json({ error: "그림(JPG·PNG)이나 PDF만 올릴 수 있어요." });
  if (!size || size > MAX_BYTES) return res.status(400).json({ error: "파일이 너무 커요(50MB까지)." });
  try {
    await ensureBucket();
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const path = `uploads/${day}/${crypto.randomUUID()}.${safeExt(fileName, contentType)}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) throw error;
    res.json({ path: data.path || path, signedUrl: data.signedUrl, token: data.token });
  } catch (e) {
    console.error("[order-files] 올리기 주소 실패:", e.message || e);
    res.status(500).json({ error: "파일 저장소를 쓸 수 없어요." });
  }
});

router.post("/download-links", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "저장소가 아직 연결 안 됐어요." });
  const paths = (req.body?.paths || []).filter((p) => typeof p === "string" && /^uploads\/\d{8}\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(p)).slice(0, 100);
  if (!paths.length) return res.status(400).json({ error: "경로가 없어요." });
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, LINK_TTL_SEC);
    if (error) throw error;
    res.json({ links: data.map((d) => ({ path: d.path, url: d.signedUrl, error: d.error || null })) });
  } catch (e) {
    console.error("[order-files] 내려받기 링크 실패:", e.message || e);
    res.status(500).json({ error: "링크를 만들지 못했어요." });
  }
});

module.exports = router;
