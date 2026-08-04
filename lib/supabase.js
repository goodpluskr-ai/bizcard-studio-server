// Supabase 서버 전용 클라이언트 — service_role 키를 씁니다(RLS를 우회해서 뭐든 할 수
// 있는 강력한 키). 그래서 절대 프론트엔드(브라우저) 코드에 이 키를 넣으면 안 되고,
// Render의 환경변수(SUPABASE_SERVICE_ROLE_KEY)에만 있어야 합니다.
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn(
    "[supabase] SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다 — " +
    "Render 대시보드의 Environment 탭에서 설정해주세요. 지금은 이 값들 없이 서버가 " +
    "켜지긴 하지만, 데이터베이스를 쓰는 요청은 전부 실패합니다."
  );
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;

module.exports = { supabase };
