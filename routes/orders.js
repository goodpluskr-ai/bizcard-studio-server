const express = require("express");
const { supabase } = require("../lib/supabase");
const { sendOrderNotificationEmail } = require("../lib/email");
const { requireAdmin } = require("../lib/adminAuth");

const router = express.Router();

function generateOrderNo() {
  // 예: BC + 현재시각 밀리초 뒤 8자리 — 지금 프론트엔드 방식과 비슷하게 맞췄습니다.
  return "BC" + String(Date.now()).slice(-8);
}

// 주문 접수 — 결제 화면에서 호출
router.post("/", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요(환경변수 확인 필요)." });
  const {
    customerPhone, customerName, categoryCode, paperCode, paperChoice,
    options, sets, memberType, amountTotal, depositorName, shipping, designRecipe,
  } = req.body || {};

  if (!depositorName || !amountTotal) {
    return res.status(400).json({ error: "입금자명과 결제금액은 필수입니다." });
  }

  const orderNo = generateOrderNo();
  const { data, error } = await supabase
    .from("orders")
    .insert({
      order_no: orderNo,
      customer_phone: customerPhone,
      customer_name: customerName,
      category_code: categoryCode,
      paper_code: paperCode,
      paper_choice: paperChoice,
      options: options || {},
      sets: sets || 1,
      member_type: memberType || "general",
      amount_total: amountTotal,
      depositor_name: depositorName,
      shipping: shipping || {},
      design_recipe: designRecipe || {},
      status: "입금대기",
    })
    .select()
    .single();

  if (error) {
    console.error("[orders] 저장 실패:", error.message);
    return res.status(500).json({ error: "주문 저장에 실패했습니다." });
  }

  // 이메일 발송 실패가 주문 접수 자체를 막으면 안 되므로, 결과를 기다리지 않고
  // (또는 기다리되) 실패해도 응답은 정상으로 내려줍니다.
  const emailResult = await sendOrderNotificationEmail({
    orderNo, depositor: depositorName, categoryName: categoryCode, amountTotal, memberType,
  });
  if (!emailResult.ok) {
    console.warn("[orders] 이메일 알림은 실패했지만 주문 접수는 정상 처리됨:", orderNo);
  }

  res.json({ order: data, emailSent: emailResult.ok });
});

// 전화번호로 내 주문 조회 (재주문 화면 등)
router.get("/", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: "phone 쿼리 파라미터가 필요합니다." });

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_phone", phone)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: "조회에 실패했습니다." });
  res.json({ orders: data });
});

// 관리자용 — 전체 주문 목록 (입금확인 대기 우선순위 없이 최신순)
router.get("/admin/all", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: "조회에 실패했습니다." });
  res.json({ orders: data });
});

// 관리자용 — 입금확인 처리
router.post("/admin/:orderNo/confirm-deposit", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "서버에 Supabase가 아직 연결 안 됐어요." });
  const { orderNo } = req.params;
  const adminName = req.admin?.name || "admin";

  const { data, error } = await supabase
    .from("orders")
    .update({ status: "입금확인", confirmed_by: adminName, confirmed_at: new Date().toISOString() })
    .eq("order_no", orderNo)
    .select()
    .single();

  if (error) return res.status(500).json({ error: "처리에 실패했습니다." });
  if (!data) return res.status(404).json({ error: "해당 주문을 찾을 수 없습니다." });
  res.json({ order: data });
});

module.exports = router;
