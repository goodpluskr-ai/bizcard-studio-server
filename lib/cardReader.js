// 명함 사진의 글자 판독 (OpenAI API)
// 2026-11-21: 명함 17장 실제 시험(gpt-5.4-mini) 결과로 채택 — 판독 정확 줄 241/250,
// 장당 평균 약 0.006달러(약 9원)·5초. 오타는 고객 확인 화면에서 정정하는 것을 전제로 함.
//
// 원칙
//  - 글자 내용만 AI가 읽는다. 글자 위치·크기는 측정 프로그램이 사진에서 직접 잰다.
//    (시험에서 AI 좌표는 단위가 매번 바뀌어 쓸 수 없었음. box는 참고용으로만 돌려줌)
//  - 인쇄된 그대로 읽는다. 맞춤법 수정은 suggestion에만, 원본 판독값(text)은 바꾸지 않는다.
//  - 낙관·도장 안의 글자는 읽지 않는다 (시험에서 3장 모두 없는 글자를 지어냄).
//  - 한자는 한자 그대로, 인쇄된 글자 모양 그대로 읽는다(한글로 바꾸지 않음). 2026-11-21 충청향우회 명함에서
//    주소 한자를 한글로 바꿔 읽은 오류가 나와 추가. 확실하지 않은 한자는 unsure로 표시 → 고객이 확대 사진으로 확인.
//  - 판독 결과는 "제안"일 뿐이다. 고객이 모든 줄을 확인·확정해야 인쇄에 쓴다.
//  - 다른 AI로 바꿀 때는 이 파일의 readCard()만 바꾸면 되도록 결과 모양을 고정한다.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OCR_MODEL || "gpt-5.4-mini";
// 1백만 토큰당 달러. 모델을 바꾸면 OCR_PRICE_IN / OCR_PRICE_OUT 환경변수로 맞춰 주세요.
const PRICE_IN = Number(process.env.OCR_PRICE_IN || 0.75);
const PRICE_OUT = Number(process.env.OCR_PRICE_OUT || 4.5);

if (!OPENAI_API_KEY) {
  console.warn(
    "[cardReader] OPENAI_API_KEY 환경변수가 없습니다 — Render 대시보드의 Environment 탭에서 " +
    "설정해주세요. 지금은 서버가 켜지긴 하지만, 명함 글자 판독 요청은 전부 실패합니다."
  );
}

const TYPES = [
  "company", "name", "title", "department", "phone", "mobile", "fax", "email", "website",
  "address", "career", "slogan", "logo_text", "form", "label", "other", "unreadable",
];

const PROMPT = `This image is the front of a Korean business card (usually 90 x 50 mm).
Transcribe ALL printed text exactly as printed.

Rules:
1. One entry per visual text line. If two separate text blocks sit on the same row but are clearly apart, make two entries. Keep letter-spaced words (for example a name like "홍 길 동") as ONE entry.
2. Copy every character exactly as printed: spelling, numbers, punctuation and symbols (·, ), :, [ ], @, .). The printed card is the only truth.
   Do NOT correct spelling, spacing or grammar, even when the printed word looks like a typo, a non-standard or colloquial spelling, or differs from a well-known phrase or proverb. Look at each syllable's actual strokes, especially in decorative fonts, instead of assuming the common word.
   Chinese characters (Hanja, 漢字): keep them as Hanja exactly as printed. NEVER convert Hanja to Hangul or Hangul to Hanja, and keep the exact character form printed (for example 鎭 and 鎮, 號 and 号 are different forms; use the one on the card). If a line mixes Hangul and Hanja, keep each character in its printed script. If you are not sure which Hanja it is, give your best reading, set "unsure": true and put the doubtful characters in "unsure_chars".
   If you believe the printed text has a spelling mistake, keep "text" exactly as printed and put your corrected version in "suggestion"; otherwise leave "suggestion" empty.
3. Include text inside logos, coloured bands and printed form fields (for example "만남: 20 년 월 일").
4. Do NOT transcribe the characters inside a stamp or seal (낙관, 도장, 인장). Add one entry for it with "text": "" and "type": "unreadable".
5. Do not invent text that is not printed.
6. If any character is not clearly legible, give your best reading, set "unsure": true and put the doubtful characters in "unsure_chars".
7. "box" is a rough box around the line: l, t, r, b as integers from 0 to 1000 of the image width (l, r) and height (t, b).
8. "type" is what the line is on the card: company, name, title, department, phone, mobile, fax, email, website, address, career (past or present positions listed as history/affiliations), slogan, logo_text, form, label, other, unreadable.
Return only the JSON.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lines"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "type", "box", "unsure", "unsure_chars", "suggestion"],
        properties: {
          text: { type: "string" },
          type: { type: "string", enum: TYPES },
          box: {
            type: "object", additionalProperties: false, required: ["l", "t", "r", "b"],
            properties: { l: { type: "number" }, t: { type: "number" }, r: { type: "number" }, b: { type: "number" } },
          },
          unsure: { type: "boolean" },
          unsure_chars: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
};

// 한자(CJK 통합 한자·호환 한자) 한 글자라도 있으면 true
const HANJA = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

// AI가 지시와 다른 단위(0~1, 0~100, 0~1000)로 좌표를 줄 때가 있어 0~1 비율로 맞춤.
// 그래도 정확하지 않으니 "대략 어디쯤"으로만 쓰고 확정 위치로 저장하지 말 것.
function normalizeBoxes(lines) {
  const vals = lines.flatMap((l) => [l.box.l, l.box.r, l.box.t, l.box.b]).filter((v) => Number.isFinite(v));
  const max = vals.length ? Math.max(...vals) : 1000;
  const scale = max <= 1.5 ? 1 : max <= 150 ? 100 : 1000;
  return lines.map((l) => {
    const c = (v) => Math.min(1, Math.max(0, v / scale));
    return { ...l, roughBox: { l: c(Math.min(l.box.l, l.box.r)), t: c(Math.min(l.box.t, l.box.b)), r: c(Math.max(l.box.l, l.box.r)), b: c(Math.max(l.box.t, l.box.b)) } };
  });
}

// jpegBase64: "data:image/jpeg;base64,..." 또는 base64 문자열
async function readCard(jpegBase64) {
  if (!OPENAI_API_KEY) return { available: false, error: "서버에 OPENAI_API_KEY가 설정 안 됐습니다." };
  const dataUrl = jpegBase64.startsWith("data:") ? jpegBase64 : "data:image/jpeg;base64," + jpegBase64;
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        input: [{ role: "user", content: [
          { type: "input_text", text: PROMPT },
          { type: "input_image", image_url: dataUrl, detail: "high" },
        ] }],
        text: { format: { type: "json_schema", name: "card_text", strict: true, schema: SCHEMA } },
      }),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[cardReader] 요청 실패:", res.status, text.slice(0, 300));
      return { available: false, error: `판독 요청 실패 (${res.status})` };
    }
    const d = await res.json();
    const msg = (d.output || []).find((o) => o.type === "message");
    const part = msg && (msg.content || []).find((c) => c.type === "output_text");
    if (!part) return { available: false, error: "판독 결과가 비어 있습니다." };
    const lines = normalizeBoxes(JSON.parse(part.text).lines).map((l) => ({
      text: l.text,
      type: l.type,
      // 한자가 한 글자라도 있는 줄은 무조건 고객 확인 대상 (지시를 해도 AI가 한자를 한글로
      // 바꾸거나 비슷한 한자로 읽는 일이 있음 — 2026-11-21 충청향우회 명함 시험)
      unsure: !!l.unsure || l.type === "unreadable" || HANJA.test(l.text || ""),
      hasHanja: HANJA.test(l.text || ""),
      unsureChars: l.unsure_chars || "",
      suggestion: l.suggestion && l.suggestion !== l.text ? l.suggestion : "",
      roughBox: l.roughBox,
    }));
    const usage = { input: (d.usage && d.usage.input_tokens) || 0, output: (d.usage && d.usage.output_tokens) || 0 };
    const costUsd = (usage.input * PRICE_IN + usage.output * PRICE_OUT) / 1e6;
    return { available: true, lines, model: d.model || MODEL, usage, costUsd, ms };
  } catch (err) {
    console.error("[cardReader] 예외:", err.message);
    return { available: false, error: err.message };
  }
}

module.exports = { readCard, normalizeBoxes, PROMPT, SCHEMA, TYPES, HANJA };
