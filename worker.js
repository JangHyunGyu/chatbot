// ===== CORS =====
const ALLOWED_ORIGINS = [
  "https://walkwithme.kr",
  "https://walkwithme.archerlab.dev",
  "http://localhost:3000", // dev
  "null", // file:// 로컬 테스트 때만 잠깐 열고, 운영에선 주석/삭제 권장
];

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});

// 안전 숫자 변환
const clamp = (v, lo, hi, dflt) =>
  Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : dflt;

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") ?? "null";

    // Preflight
    if (req.method === "OPTIONS") {
      // 허용되지 않은 출처여도 CORS 헤더를 달아줘야 브라우저가 오류를 읽을 수 있어요.
      const headers = corsHeaders(origin);
      if (!ALLOWED_ORIGINS.includes(origin)) {
        return new Response(null, { status: 403, headers });
      }
      return new Response(null, { status: 204, headers });
    }

    // 헬스체크(선택): GET으로 살아있는지 확인
    if (req.method === "GET") {
      return new Response(JSON.stringify({ ok: true, service: "walkwithme-api" }), {
        status: 200,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ error: "Forbidden origin" }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // 키 누락 방지
    if (!env?.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Body 파싱 (req.json()만 쓰면 빈 바디/잘못된 JSON에서 예외)
    let body;
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // 옵션 오버라이드 허용(없으면 기본값)
    //const model = (body?.model || "gpt-5").trim();
    const model = (body?.model || "gpt-5-mini").trim();

    // OpenAI 호출
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
      }),
    });

    const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };
    const raw = await upstream.text();

    // 에러는 상태 그대로 패스(디버깅 쉬움)
    if (!upstream.ok) {
      return new Response(raw, { status: upstream.status, headers });
    }

    // 그대로 전달(또는 아래처럼 content만 뽑아 JSON으로 감싸도 됨)
    return new Response(raw, { status: 200, headers });
  },
};
