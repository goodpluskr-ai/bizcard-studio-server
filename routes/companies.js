const express = require("express");
const { supabase } = require("../lib/supabase");
const { requireAdmin } = require("../lib/adminAuth");

const router = express.Router();

// 2026-08-11: "GET /api/companies가 없어서 로고 라이브러리 조회가 계속 실패하고
// 있었다"는 걸 발견해서 전체적으로 다시 맞췄습니다. 문제가 두 가지 겹쳐 있었습니다:
// 1) 프론트엔드(companyResolver.js)는 { company: {...전체 객체} } 형태로 보내는데
//    이 파일은 req.body를 바로 { name, logoUrl, ... }로 분해하고 있어서 name이
//    항상 undefined → 저장 요청이 매번 400으로 실패했습니다.
// 2) 프론트엔드가 보내는 회사 객체는 aliases/brandColor/industry/emailDomains 등
//    필드가 많은데, supabase_schema.sql은 이미 이걸 위해 companies 테이블에
//    data jsonb + client_id 컬럼을 추가해뒀지만(2026-08-04), 이 라우트 코드는 그
//    이전의 단순한 컬럼(name/logo_url/source)만 쓰고 있어서 스키마와 안 맞았습니다.
// 아래는 실제 스키마(data jsonb, client_id)에 맞춰 다시 작성한 버전입니다.
// client_id는 프론트엔드가 회사명으로 직접 만드는 문자열 id(예: "samsung_fire")이고,
// Supabase의 내부 uuid(id 컬럼)와는 다른 값입니다 — approve/reject가 받는 :id는
// 전부 이 client_id입니다.

// 회사(로고) 등록 신청 — 로그인 불필요(일반회원도 셀프로 첫 등록 가능)
router.post("/", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { company } = req.body || {};
  if (!company?.id || !company?.name) {
    return res.status(400).json({ error: "company.id와 company.name은 필수입니다." });
  }

  const { data, error } = await supabase
    .from("companies")
    .upsert(
      { client_id: company.id, status: company.status || "pending", data: company },
      { onConflict: "client_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[companies] 저장 실패:", error.message);
    return res.status(500).json({ error: "등록에 실패했습니다." });
  }
  res.json({ company: data.data });
});

// 조회 — 로그인 불필요. Design.jsx(고객, resolveCompany용)와 Admin.jsx(관리자,
// pending/승인목록 전체) 둘 다 이 하나의 목록을 그대로 씁니다(각자 필요한 status만
// 화면에서 걸러 씀 — Admin.jsx의 pending/others 분리가 그 예).
router.get("/", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { data, error } = await supabase.from("companies").select("data").order("created_at", { ascending: true });
  if (error) {
    console.error("[companies] 조회 실패:", error.message);
    return res.status(500).json({ error: "조회에 실패했습니다." });
  }
  res.json({ companies: (data || []).map((row) => row.data) });
});

// 관리자용 — 검토 대기 목록만 (지금 프론트엔드는 이 엔드포인트를 직접 부르지 않고
// 위 GET / 하나로 전체를 받아 화면에서 걸러 쓰지만, 나중에 목록이 커지면 이걸 쓰도록
// 남겨둡니다).
router.get("/admin/pending", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { data, error } = await supabase
    .from("companies")
    .select("data")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "조회에 실패했습니다." });
  res.json({ companies: (data || []).map((row) => row.data) });
});

// 관리자용 — 승인. status 컬럼과 data.status를 둘 다 갱신합니다(status 컬럼은
// 빠른 필터링용, data는 프론트엔드가 실제로 읽는 전체 객체).
router.post("/admin/:id/approve", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { data: existing, error: fetchError } = await supabase
    .from("companies")
    .select("data")
    .eq("client_id", req.params.id)
    .single();
  if (fetchError || !existing) return res.status(404).json({ error: "회사를 찾을 수 없습니다." });

  const updatedCompany = {
    ...existing.data,
    status: "verified",
    approvedBy: req.admin?.name || "admin",
    approvedAt: Date.now(),
  };

  const { data, error } = await supabase
    .from("companies")
    .update({ status: "verified", approved_by: req.admin?.name || "admin", approved_at: new Date().toISOString(), data: updatedCompany })
    .eq("client_id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: "처리에 실패했습니다." });
  res.json({ company: data.data });
});

// 관리자용 — 반려. companyResolver.js의 removeCompany() 주석에 "반려된 로고는
// 상태만 바꾸는 게 아니라 완전히 삭제한다(resolveCompany가 status를 안 보고 이름만
// 보고 찾기 때문에 남아있으면 다시 쓰일 수 있음)"고 명시돼 있어서, 여기서도
// update가 아니라 실제 delete로 처리합니다.
router.post("/admin/:id/reject", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { error } = await supabase.from("companies").delete().eq("client_id", req.params.id);
  if (error) return res.status(500).json({ error: "처리에 실패했습니다." });
  res.json({ ok: true });
});

module.exports = router;
