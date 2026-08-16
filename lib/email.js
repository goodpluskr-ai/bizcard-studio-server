// 서버에서 EmailJS를 호출합니다 — 브라우저(Claude 아티팩트)에서는 CSP 때문에 이 호출이
// 막혔었지만(2026-08-03 확인됨), 서버는 브라우저가 아니라서 그 제한 자체가 없습니다.
// Node 18 이상은 fetch가 기본 내장이라 별도 패키지 없이 그대로 씁니다.

const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const ORDER_EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_c48f848";
const EMAILJS_ORDER_TEMPLATE_ID = process.env.EMAILJS_ORDER_TEMPLATE_ID || "template_fgijlbe";

async function sendOrderNotificationEmail({ orderNo, depositor, categoryName, amountTotal, memberType, bundleAlone }) {
  if (!EMAILJS_PUBLIC_KEY) {
    console.warn("[email] EMAILJS_PUBLIC_KEY가 없어서 이메일 발송을 건너뜁니다.");
    return { ok: false, skipped: true };
  }
  const message =
    `새 주문이 접수됐습니다.\n\n` +
    `주문번호: ${orderNo}\n` +
    `입금자명: ${depositor || "-"}\n` +
    `카테고리: ${categoryName || "-"}\n` +
    `결제금액: ${amountTotal != null ? amountTotal.toLocaleString("ko-KR") + "원" : "-"}\n` +
    `회원구분: ${memberType === "special" ? "특별회원" : "일반회원"}` +
    // 2026-08-16: 묶음배송 전화번호를 입력했는데 같은 번호로 접수된 다른(동료) 주문이
    // 없으면, 무료배송 조건이 실제로는 충족 안 된 상태라 착불로 나가야 합니다 —
    // 관리자가 바로 알아차리도록 이메일 맨 위에 눈에 띄게 붙입니다.
    (bundleAlone ? `\n\n⚠ 묶음배송 동료 없음 — 착불로 발송해주세요.` : "");

  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: ORDER_EMAILJS_SERVICE_ID,
        template_id: EMAILJS_ORDER_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          name: depositor || "고객",
          message,
          order_id: orderNo,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[email] 발송 실패:", res.status, text);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    // 실제 서버 환경에서는 이 catch가 거의 안 걸릴 것으로 예상됩니다(CSP 문제가 없으므로) —
    // 그래도 네트워크 순간 장애 등에 대비해 주문 접수 자체는 막지 않도록 에러만 기록합니다.
    console.error("[email] 발송 중 예외:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendOrderNotificationEmail };
