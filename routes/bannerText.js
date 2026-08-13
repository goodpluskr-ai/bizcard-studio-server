const express = require("express");
const { supabase } = require("../lib/supabase");
const { requireAdmin } = require("../lib/adminAuth");

const router = express.Router();

// 2026-08-11: "관리자가 홈 배너 문구를 바꿀 수 있게 해달라"는 요청 반영 — 이 앱
// 문구(TEXTS) 수백 개를 전부 편집 가능하게 만들면 범위가 너무 커서, 홈 화면 상단
// 배너에 쓰이는 문구 6개만 우선 대상으로 좁혔습니다(프론트엔드
// domain/content/bannerText.js의 EDITABLE_BANNER_KEYS 참고). companies.js와 같은
// 패턴 — key/value 한 줄씩 저장하고, 조회는 누구나(고객 화면도 읽어야 하니), 저장은
// 관리자만 가능하게 했습니다.
//
// Supabase에 banner_text 테이블이 필요합니다:
//   create table banner_text (
//     key text primary key,
//     value text not null,
//     updated_at timestamptz not null default now()
//   );

// 홈 화면(고객)이 읽는 조회 — 로그인 불필요.
router.get("/", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { data, error } = await supabase.from("banner_text").select("key, value");
  if (error) return res.status(500).json({ error: "조회에 실패했습니다." });
  const overrides = {};
  for (const row of data || []) overrides[row.key] = row.value;
  res.json({ overrides });
});

// 관리자가 저장 — { overrides: { appTagline: "...", homeBannerTitle: "...", ... } }
// 값이 빈 문자열이면 그 키는 지워서(기본 문구로 자연스럽게 되돌아가도록) 처리합니다.
router.post("/", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { overrides } = req.body || {};
  if (!overrides || typeof overrides !== "object") {
    return res.status(400).json({ error: "overrides 객체가 필요합니다." });
  }

  const toUpsert = [];
  const keysToDelete = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (value && String(value).trim()) {
      toUpsert.push({ key, value: String(value), updated_at: new Date().toISOString() });
    } else {
      keysToDelete.push(key);
    }
  }

  if (toUpsert.length > 0) {
    const { error: upsertError } = await supabase.from("banner_text").upsert(toUpsert, { onConflict: "key" });
    if (upsertError) return res.status(500).json({ error: "저장에 실패했습니다." });
  }
  if (keysToDelete.length > 0) {
    const { error: deleteError } = await supabase.from("banner_text").delete().in("key", keysToDelete);
    if (deleteError) return res.status(500).json({ error: "저장에 실패했습니다." });
  }

  res.json({ ok: true });
});

module.exports = router;
