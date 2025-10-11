// ===== CORS =====
// 클라이언트 요청을 허용할 도메인 목록입니다.
const ALLOWED_ORIGINS = [
  "https://walkwithme.kr",
  "https://walkwithme.archerlab.dev",
  "http://localhost:3000", // dev
  "null", // file:// 로컬 테스트 때만 잠깐 열고, 운영에선 주석/삭제 권장
];

// 요청 Origin에 맞는 CORS 헤더를 만들어 반환합니다.
const corsHeaders = (origin) => ({
  // 허용 목록에 존재하면 해당 Origin을, 아니면 기본값을 사용합니다.
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  // 허용할 HTTP 메서드 목록입니다.
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // 클라이언트가 보낼 수 있는 헤더를 명시합니다.
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  // 캐시가 Origin 헤더에 따라 달라짐을 알립니다.
  "Vary": "Origin",
});

// 안전 숫자 변환 유틸 (현재는 사용하지 않지만 참고용으로 남겨둔 예시입니다.)
const clamp = (v, lo, hi, dflt) =>
  Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : dflt;

// 기본 워커 핸들러를 export 합니다.
export default {
  // Cloudflare Workers의 fetch 이벤트 진입점입니다.
  async fetch(req, env) {
    // 요청 헤더 Origin을 읽고 없으면 "null"로 처리합니다.
    const origin = req.headers.get("Origin") ?? "null";

    // Preflight
    if (req.method === "OPTIONS") {
      // 허용되지 않은 출처여도 CORS 헤더를 달아줘야 브라우저가 오류를 읽을 수 있어요.
      const headers = corsHeaders(origin);
      if (!ALLOWED_ORIGINS.includes(origin)) {
        // 등록되지 않은 Origin의 사전 요청은 403으로 응답합니다.
        return new Response(null, { status: 403, headers });
      }
      // 허용된 Origin의 사전 요청은 204 No Content로 처리합니다.
      return new Response(null, { status: 204, headers });
    }

    // 헬스체크(선택): GET으로 살아있는지 확인
    if (req.method === "GET") {
      // 간단한 JSON을 반환해 모니터링 시 살아있는지 확인할 수 있게 합니다.
      return new Response(JSON.stringify({ ok: true, service: "walkwithme-api" }), {
        status: 200,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // 허용되지 않은 Origin의 POST 요청은 차단합니다.
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ error: "Forbidden origin" }), {
        status: 403,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // 키 누락 방지
    if (!env?.OPENAI_API_KEY) {
      // 환경 변수에 OpenAI 키가 없으면 서버 오류로 응답합니다.
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // Body 파싱 (req.json()만 쓰면 빈 바디/잘못된 JSON에서 예외)
    let body;
    try {
      // 텍스트로 먼저 읽어 비어 있는 경우를 구분합니다.
      const text = await req.text();
      // 내용이 있으면 JSON으로 파싱, 없으면 빈 객체로 처리합니다.
      body = text ? JSON.parse(text) : {};
    } catch {
      // JSON 파싱 실패 시 400 Bad Request를 반환합니다.
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // 요청 본문에서 messages 배열을 꺼냅니다.
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      // 배열이 아니거나 비어 있으면 에러를 반환합니다.
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    // 옵션 오버라이드 허용(없으면 기본값)
    //const model = (body?.model || "gpt-5").trim();
    // 모델이 넘어오지 않으면 gpt-5-mini를 기본값으로 사용합니다.
    const model = (body?.model || "gpt-5-mini").trim();

    // OpenAI 호출
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      // Chat Completions 엔드포인트로 POST 요청을 보냅니다.
      method: "POST",
      headers: {
        // JSON 본문을 전달합니다.
        "Content-Type": "application/json",
        // OpenAI API 키를 Authorization 헤더에 포함합니다.
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        // 선택된 모델과 메시지 배열을 그대로 전달합니다.
        model,
        messages,
      }),
    });

    // 응답에 공통으로 사용할 헤더를 미리 구성합니다.
    const headers = { ...corsHeaders(origin), "Content-Type": "application/json" };
    // OpenAI 응답을 텍스트로 읽어둡니다.
    const raw = await upstream.text();

    // 에러는 상태 그대로 패스(디버깅 쉬움)
    if (!upstream.ok) {
      // OpenAI에서 에러가 나면 상태 코드와 본문을 그대로 전달합니다.
      return new Response(raw, { status: upstream.status, headers });
    }

    // 그대로 전달(또는 아래처럼 content만 뽑아 JSON으로 감싸도 됨)
    return new Response(raw, { status: 200, headers });
  },
};
