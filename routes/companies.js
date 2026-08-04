const express = require("express");
const { supabase } = require("../lib/supabase");
const { requireAdmin } = require("../lib/adminAuth");

const router = express.Router();

// 회사(로고) 등록 신청
router.post("/", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { name, logoUrl, source, registeredBy } = req.body || {};
  if (!name) return res.status(400).json({ error: "회사명은 필수입니다." });

  const { data, error } = await supabase
    .from("companies")
    .insert({ name, logo_url: logoUrl, source: source || "user_upload", registered_by: registeredBy, status: "pending" })
    .select()
    .single();

  if (error) return res.status(500).json({ error: "등록에 실패했습니다." });
  res.json({ company: data });
});

// 관리자용 — 검토 대기 목록
router.get("/admin/pending", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { data, error } = await supabase.from("companies").select("*").eq("status", "pending").order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: "조회에 실패했습니다." });
  res.json({ companies: data });
});

// 관리자용 — 승인
router.post("/admin/:id/approve", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { data, error } = await supabase
    .from("companies")
    .update({ status: "verified", approved_by: req.admin?.name || "admin", approved_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: "처리에 실패했습니다." });
  res.json({ company: data });
});

// 관리자용 — 반려
router.post("/admin/:id/reject", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { data, error } = await supabase
    .from("companies")
    .update({ status: "rejected", approved_by: req.admin?.name || "admin", approved_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: "처리에 실패했습니다." });
  res.json({ company: data });
});

module.exports = router;
