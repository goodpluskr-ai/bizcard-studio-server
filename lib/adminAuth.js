// 아주 가벼운 관리자 인증 — 정식 라이브러리(jsonwebtoken 등) 없이 Node 기본 crypto로
// "서명된 토큰"을 직접 만듭니다. 지금 프론트엔드의 "비밀번호만 맞으면 통과, 새로고침하면
// 풀림" 방식보다 훨씬 안전합니다 — 토큰은 서버만 아는 비밀키(ADMIN_TOKEN_SECRET)로
// 서명돼서, 그 비밀키 없이는 아무도 가짜 토큰을 만들 수 없습니다.
// 나중에 관리자가 여러 명이 되거나 더 정교한 권한 관리가 필요해지면 그때
// jsonwebtoken 같은 정식 라이브러리로 바꾸면 됩니다("실제 필요가 확인된 뒤에 만든다").

const crypto = require("crypto");

const SECRET = process.env.ADMIN_TOKEN_SECRET || "change-me-in-render-env-vars";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12시간 — 이 시간 지나면 다시 로그인 필요

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expectedSig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  // 타이밍 공격 방지를 위해 crypto.timingSafeEqual 사용
  const sigBuf = Buffer.from(sig || "");
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || Date.now() > data.exp) return null; // 만료됨
    return data;
  } catch {
    return null;
  }
}

function issueAdminToken(name = "admin") {
  return sign({ name, exp: Date.now() + TOKEN_TTL_MS });
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const data = verify(token);
  if (!data) return res.status(401).json({ error: "관리자 로그인이 필요합니다(토큰이 없거나 만료됨)." });
  req.admin = data;
  next();
}

module.exports = { issueAdminToken, requireAdmin };
