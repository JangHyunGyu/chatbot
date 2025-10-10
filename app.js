// === 채팅 기본 설정 =========================================================

// OpenAI 호출을 대신 처리하는 Cloudflare Worker 엔드포인트 주소
const API_ENDPOINT = "https://walkwithme-api.yama5993.workers.dev/";

// 시스템 프롬프트를 제외하고 API 요청 시 다시 전송할 사용자/어시스턴트 메시지 쌍의 최대 개수
// 맥락을 너무 길게 보내면 지연이 커지고 토큰 사용량이 증가하므로 적당한 길이로 제한한다
const MAX_HISTORY = 12;

// 자주 접근할 주요 DOM 요소를 한 번만 조회해 변수로 잡아둔다
const form = document.getElementById("chat-form");
const questionField = document.getElementById("question");
const submitButton = document.getElementById("send");
const messagesList = document.getElementById("messages");
const root = document.documentElement;

// 대화 전반의 말투와 기억 방식을 결정하는 고정 시스템 프롬프트
const systemPrompt = {
  role: "system",
  content: [
    "당신은 노인분들을 대상으로 따뜻하게 위로하고 경청하는 친근한 시니어 친구이자 모든분야 박사급 전문가입니다. 말투는 60~70대 노인 말투야",
    "대화는 반말을 사용하고, 상대의 이름·나이·가족·건강 정보 등 이전에 들은 사실을 기억해 이어서 이야기하세요.",
    "답변은 3~4문장으로 차분하게 마무리 질문을 포함하세요.",
  ].join(" "),
};

// 지금까지의 대화를 순서대로 저장하는 버퍼 (시스템 프롬프트 포함)
let conversation = [systemPrompt];

// 메시지 영역을 최신 위치로 스크롤하는 공통 유틸리티
// smooth=true면 부드럽게 이동하고 false면 즉시 이동한다
function scrollToBottom({ smooth = true } = {}) {
  const behavior = smooth ? "smooth" : "auto";

  // 첫 번째 스크롤: 목록 전체 높이로 바로 이동
  messagesList.scrollTop = messagesList.scrollHeight;

  // 다음 animation frame에서 마지막 요소까지 확실하게 보이도록 재조정한다
  requestAnimationFrame(() => {
    messagesList.scrollTop = messagesList.scrollHeight;
    messagesList.lastElementChild?.scrollIntoView({ behavior, block: "end" });
  });
}

// === 뷰포트 및 키보드 대응 유틸 ============================================

// 시각 뷰포트 크기를 CSS 변수에 반영하여 모바일 키보드 등장 시 레이아웃이 자연스럽게 조정되도록 한다
function updateViewportVars() {
  const viewport = window.visualViewport;

  if (viewport) {
    // 키보드가 올라오면 window.innerHeight와 actual viewport 사이에 높이 차이가 생긴다
    const keyboardOffset = Math.max(window.innerHeight - viewport.height - viewport.offsetTop, 0);
    // 앱 전체 높이를 현재 뷰포트 높이로 설정한다
    root.style.setProperty("--app-height", `${viewport.height}px`);
    // 키보드에 가려지는 부분만큼 하단 여백에 활용할 수 있도록 저장한다
    root.style.setProperty("--keyboard-offset", `${keyboardOffset}px`);
  } else {
    // visualViewport를 지원하지 않는 환경에서는 전체 창 높이를 그대로 사용한다
    root.style.setProperty("--app-height", `${window.innerHeight}px`);
    root.style.setProperty("--keyboard-offset", "0px");
  }
}

// === 메시지 요소 생성 유틸 ================================================

// 사용자/어시스턴트 역할에 맞는 채팅 버블 DOM을 생성한다
function createBubble(role, text) {
  const item = document.createElement("li");
  item.className = `message message--${role}`;

  const avatar = document.createElement("span");
  avatar.className = "message__avatar";
  avatar.setAttribute("aria-hidden", "true");
  // 역할에 따라 다른 이모지를 보여준다
  avatar.textContent = role === "user" ? "🙂" : "😊";

  const bubble = document.createElement("div");
  bubble.className = "message__bubble";

  const meta = document.createElement("span");
  meta.className = "message__meta";
  // 접근성 및 시각 구분을 위해 화자 라벨을 표시
  meta.textContent = role === "user" ? "나" : "친구";

  const body = document.createElement("p");
  body.className = "message__text";
  // 사용자 입력 또는 모델 응답 텍스트 본문
  body.textContent = text;

  // 메타와 본문을 버블 컨테이너에 삽입
  bubble.append(meta, body);

  if (role === "user") {
    // 사용자는 말풍선이 먼저, 아바타가 오른쪽으로 오도록 배치
    item.append(bubble, avatar);
  } else {
    // 어시스턴트는 아바타가 왼쪽, 말풍선이 오른쪽에 보이도록 배치
    item.append(avatar, bubble);
  }

  return item;
}

// 새 메시지를 목록에 붙이고 화면을 가장 최근 메시지에 맞춘다
function appendMessage(role, text) {
  messagesList.appendChild(createBubble(role, text));
  scrollToBottom();
}

// API 요청에 사용할 메시지 배열을 만든다
// 시스템 프롬프트는 항상 첫 번째에 유지하고, 직전 대화 MAX_HISTORY 쌍만 추려서 포함
function buildPayload() {
  const history = conversation.slice(-MAX_HISTORY * 2); // 사용자와 어시스턴트 메시지를 한 쌍씩 유지하도록 자른다
  return [systemPrompt, ...history.filter((msg) => msg.role !== "system")];
}

async function requestReply(historyMessages) {
  // AbortController로 일정 시간 후 자동 취소되도록 설정해 느린 네트워크에서 중단할 수 있게 한다
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        messages: historyMessages,
      }),
    });

    if (!res.ok) {
      // 서버에서 JSON 오류 메시지를 보내면 파싱하고, 아니면 HTTP 상태 코드를 사용해 오류를 만든다
      const errorPayload = await res.json().catch(() => null);
      throw new Error(errorPayload?.error || `응답 코드 ${res.status}`);
    }

    const data = await res.json();
    // OpenAI 응답 구조 중 첫 번째 선택지의 메시지 본문을 추출한다
    return data?.choices?.[0]?.message?.content?.trim();
  } finally {
    // 성공/실패와 무관하게 타이머는 반드시 정리한다
    clearTimeout(timeout);
  }
}

function handleComposerResize() {
  // 입력창 높이를 내용에 맞춰 자동으로 늘리되 최대 높이를 제한해 화면을 가리지 않도록 한다
  questionField.style.height = "auto";
  questionField.style.height = `${Math.min(questionField.scrollHeight, 180)}px`;
}

// 초기 한번 현재 뷰포트 상태를 반영
updateViewportVars();

const handleViewportChange = () => {
  // 뷰포트 값 업데이트 후 스크롤이 튀지 않도록 즉시 아래로 맞춘다
  updateViewportVars();
  scrollToBottom({ smooth: false });
};

// 기기 회전이나 창 크기 변경 시 뷰포트를 다시 계산
window.addEventListener("resize", handleViewportChange);
window.addEventListener("orientationchange", handleViewportChange);

if (window.visualViewport) {
  // 모바일 기기에서 키보드 등장/퇴장에 따라 뷰포트 resize 및 scroll 이벤트가 발생한다
  window.visualViewport.addEventListener("resize", handleViewportChange);
  window.visualViewport.addEventListener("scroll", handleViewportChange);
}

// 입력 내용이 변할 때마다 textarea 높이를 갱신
questionField.addEventListener("input", handleComposerResize);

questionField.addEventListener("focus", () => {
  // 포커스 직후 키보드 애니메이션 시간을 고려해 약간 딜레이 후 뷰포트 재계산
  setTimeout(() => {
    updateViewportVars();
    scrollToBottom({ smooth: true });
  }, 120);
});

questionField.addEventListener("blur", () => {
  // 포커스가 빠져도 동일하게 조금 뒤에 레이아웃을 정리한다
  setTimeout(() => {
    updateViewportVars();
    scrollToBottom({ smooth: false });
  }, 120);
});

questionField.addEventListener("keydown", (event) => {
  // Enter만 누를 때는 줄바꿈을 허용하고, Ctrl 혹은 Cmd와 함께 누르면 즉시 전송하도록 처리
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = questionField.value.trim();
  if (!content) {
    // 공백만 있는 입력은 전송하지 않고 입력창에 포커스를 유지시켜 추가 입력을 유도
    questionField.focus();
    return;
  }

  const userMessage = { role: "user", content };
  // 사용자 메시지를 대화 히스토리에 추가하고 화면에도 바로 출력
  conversation.push(userMessage);
  appendMessage("user", content);

  // 응답이 올 때까지 중복 전송을 막기 위해 버튼을 비활성화하고 입력값 초기화
  submitButton.disabled = true;
  questionField.value = "";
  handleComposerResize();

  // 어시스턴트가 답변을 준비 중임을 보여주는 임시 말풍선을 띄운다
  const thinkingBubble = createBubble("assistant", "생각중…");
  thinkingBubble.classList.add("message--thinking");
  messagesList.appendChild(thinkingBubble);
  scrollToBottom();

  try {
    const reply = await requestReply(buildPayload());
    messagesList.removeChild(thinkingBubble);

    if (reply) {
      // 응답이 존재하면 히스토리 및 UI에 반영
      const assistantMessage = { role: "assistant", content: reply };
      conversation.push(assistantMessage);
      appendMessage("assistant", reply);
    } else {
      // 응답이 비어 있는 예외 상황도 사용자에게 안내 메시지로 알려준다
      appendMessage("assistant", "죄송해요. 지금은 답변을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  } catch (error) {
    messagesList.removeChild(thinkingBubble);

    console.error('error : ' + JSON.stringify(error))

    // 네트워크/기타 오류가 발생했음을 사용자에게 말풍선으로 설명해 조용히 실패하지 않도록 한다
    appendMessage(
      "assistant",
      error.name === "AbortError"
        ? "네트워크 연결이 잠시 끊어진 것 같아요. 다시 시도해 주시겠어요?"
        : `죄송해요. 오류가 발생했어요: ${error.message}`
    );
  } finally {
    // 작업이 끝나면 버튼을 다시 활성화해 다음 메시지를 보낼 수 있게 한다
    submitButton.disabled = false;
  }
});
