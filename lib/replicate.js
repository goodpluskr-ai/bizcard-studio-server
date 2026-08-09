// Replicate API(Flux Schnell)로 배경 이미지를 생성합니다.
// 2026-08-08: AI 배경 생성 기능을 처음 실제로 연결하면서 추가 — 이전까지는
// domain/generative/backgroundEngine.js의 callImageGenerationApi()가 항상
// { available: false }만 반환하는 빈 자리였습니다.

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const MODEL = "black-forest-labs/flux-schnell";

if (!REPLICATE_API_TOKEN) {
  console.warn(
    "[replicate] REPLICATE_API_TOKEN 환경변수가 없습니다 — Render 대시보드의 " +
    "Environment 탭에서 설정해주세요. 지금은 이 값 없이 서버가 켜지긴 하지만, " +
    "배경 생성 요청은 전부 실패합니다."
  );
}

// Flux는 정해진 비율 프리셋 중에서 고르는 방식입니다(자유로운 임의 비율 불가) —
// 명함 규격(가로:세로)에 로그 스케일 기준으로 가장 가까운 프리셋을 고릅니다.
const ASPECT_PRESETS = ["1:1", "4:3", "3:2", "16:9", "21:9", "2:3", "3:4", "9:16", "9:21"];
const ASPECT_VALUES = { "1:1": 1, "4:3": 4 / 3, "3:2": 3 / 2, "16:9": 16 / 9, "21:9": 21 / 9, "2:3": 2 / 3, "3:4": 3 / 4, "9:16": 9 / 16, "9:21": 9 / 21 };

function closestAspectRatio(widthMm, heightMm) {
  const target = widthMm / heightMm;
  let best = "16:9";
  let bestDiff = Infinity;
  for (const preset of ASPECT_PRESETS) {
    const diff = Math.abs(Math.log(ASPECT_VALUES[preset] / target));
    if (diff < bestDiff) { bestDiff = diff; best = preset; }
  }
  return best;
}

async function pollPrediction(url, maxTries = 40, intervalMs = 1000) {
  for (let i = 0; i < maxTries; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` } });
    const data = await res.json();
    if (data.status === "succeeded" || data.status === "failed" || data.status === "canceled") return data;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: "failed", error: "시간 초과(40초) — Replicate 응답이 너무 오래 걸렸습니다." };
}

// widthMm/heightMm(카드 규격)에 가장 가까운 비율로 배경 이미지 1장을 생성합니다.
// ⚠️ 비용이 실제로 발생하는 호출입니다 — 호출할 때마다 Flux Schnell 요금이
// 청구됩니다(장당 약 1~4원 수준, 2026-08 기준). 호출 빈도는 프론트엔드에서
// 재생성 횟수 제한 같은 정책으로 관리해야 합니다.
async function generateBackgroundImage(prompt, widthMm = 90, heightMm = 50) {
  if (!REPLICATE_API_TOKEN) {
    return { available: false, error: "서버에 REPLICATE_API_TOKEN이 설정 안 됐습니다." };
  }
  const aspectRatio = closestAspectRatio(widthMm, heightMm);
  try {
    const res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait", // Replicate가 지원하는 헤더 — 짧은 작업이면 완료까지 기다렸다가 응답
      },
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: aspectRatio,
          num_outputs: 1,
          output_format: "jpg",
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[replicate] 요청 실패:", res.status, text);
      return { available: false, error: `Replicate 요청 실패 (${res.status})` };
    }
    let prediction = await res.json();
    if (prediction.status !== "succeeded" && prediction.status !== "failed") {
      prediction = await pollPrediction(prediction.urls.get);
    }
    if (prediction.status !== "succeeded") {
      console.error("[replicate] 생성 실패:", prediction.error);
      return { available: false, error: prediction.error || "이미지 생성에 실패했습니다." };
    }
    const images = Array.isArray(prediction.output) ? prediction.output : [prediction.output];
    return { available: true, images, aspectRatio };
  } catch (err) {
    console.error("[replicate] 예외:", err.message);
    return { available: false, error: err.message };
  }
}

module.exports = { generateBackgroundImage, closestAspectRatio };
