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
//  - 같은 사진을 두 번 읽어 비교한다 — 다르면 확인 필요(읽을 때마다 록/독/복, 쏘/소로 흔들림).
//  - 같은 사진을 두 번 읽어 줄마다 비교한다. 다르면 확인 필요(읽을 때마다 록/독/복, 쏘/소로 흔들림).
//  - 판독 결과는 "제안"일 뿐이다. 고객이 모든 줄을 확인·확정해야 인쇄에 쓴다.
//  - 다른 AI로 바꿀 때는 이 파일의 readCard()만 바꾸면 되도록 결과 모양을 고정한다.

const { compareReads, mergeSingleChars } = require("./doubleRead");

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

// AI에게 한 번 읽히기 — 원래 응답의 줄 목록(lines)을 그대로 돌려줌
async function readOnce(dataUrl) {
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
    const usage = { input: (d.usage && d.usage.input_tokens) || 0, output: (d.usage && d.usage.output_tokens) || 0 };
    return { available: true, lines: JSON.parse(part.text).lines || [], model: d.model || MODEL, usage, ms };
  } catch (err) {
    console.error("[cardReader] 예외:", err.message);
    return { available: false, error: err.message };
  }
}

// jpegBase64: "data:image/jpeg;base64,..." 또는 base64 문자열
// 2026-11-22: 같은 사진을 동시에 두 번 읽고(시간은 한 번과 비슷, 비용은 두 배 ≈ 장당 18원) 줄마다 비교 —
// 두 판독이 다르면 확인 필요 + 다른 쪽 판독(secondRead.alt)을 함께 돌려줌. 한쪽이 실패하면 나머지 하나로 진행.
async function readCard(jpegBase64) {
  if (!OPENAI_API_KEY) return { available: false, error: "서버에 OPENAI_API_KEY가 설정 안 됐습니다." };
  const dataUrl = jpegBase64.startsWith("data:") ? jpegBase64 : "data:image/jpeg;base64," + jpegBase64;
  const [r1, r2] = await Promise.all([readOnce(dataUrl), readOnce(dataUrl)]);
  const ok = [r1, r2].filter((r) => r.available);
  if (!ok.length) return { available: false, error: r1.error || r2.error || "판독에 실패했습니다." };
  const first = ok[0];
  let base = mergeSingleChars(first.lines);
  if (ok.length === 2) base = compareReads(base, ok[1].lines);
  else base = base.map((l) => ({ ...l, secondRead: { status: "unavailable" } }));

  const lines = normalizeBoxes(base).map((l) => {
    const sr = l.secondRead || { status: "unavailable" };
    const diff = sr.status === "diff" || sr.status === "missing";
    return {
      text: l.text,
      type: l.type,
      // 한자가 한 글자라도 있는 줄은 무조건 고객 확인 대상 (지시를 해도 AI가 한자를 한글로
      // 바꾸거나 비슷한 한자로 읽는 일이 있음 — 2026-11-21 충청향우회 명함 시험)
      // 두 번 읽은 결과가 다른 줄도 확인 대상
      unsure: !!l.unsure || l.type === "unreadable" || HANJA.test(l.text || "") || diff,
      hasHanja: HANJA.test(l.text || ""),
      unsureChars: l.unsure_chars || "",
      suggestion: l.suggestion && l.suggestion !== l.text ? l.suggestion : "",
      secondRead: sr,
      roughBox: l.roughBox,
    };
  });
  // 명함에 한자가 한 곳이라도 있으면 한자 명함으로 보고, 한글이 들어간 줄도 모두 확인 대상.
  // AI가 한자 줄을 통째로 한글로 바꿔 읽으면(예: 서울特別市 中區 三一大路 → 서울특별시 중구 삼일대로)
  // 그 줄에는 한자가 안 남아 위 규칙으로 못 잡기 때문 (2026-11-21 재시험).
  // 숫자·영문 위주 줄(전화·팩스·이메일·홈페이지)은 제외.
  const hanjaCard = lines.some((l) => l.hasHanja);
  if (hanjaCard) {
    for (const l of lines) {
      if (!l.hasHanja && /[가-힣]/.test(l.text || "") && !["phone", "mobile", "fax", "email", "website"].includes(l.type)) {
        l.unsure = true;
        l.hanjaCardCheck = true;
      }
    }
  }
  const usage = { input: ok.reduce((s, r) => s + r.usage.input, 0), output: ok.reduce((s, r) => s + r.usage.output, 0) };
  const costUsd = (usage.input * PRICE_IN + usage.output * PRICE_OUT) / 1e6;
  const ms = Math.max(...ok.map((r) => r.ms));
  return { available: true, lines, hanjaCard, reads: ok.length, model: first.model, usage, costUsd, ms };
}

module.exports = { readCard, normalizeBoxes, PROMPT, SCHEMA, TYPES, HANJA };
