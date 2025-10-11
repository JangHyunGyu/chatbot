// API 요청을 보낼 Cloudflare Workers 엔드포인트 URL을 상수로 정의합니다.
const API_ENDPOINT = "https://walkwithme-api.yama5993.workers.dev/";
// 사용자와 어시스턴트의 대화 기록을 최대 몇 쌍까지 보존할지 지정합니다.
const MAX_HISTORY = 12; // user+assistant pairs (excluding system message)

// 채팅 입력 폼 요소를 캐싱하여 DOM 탐색을 반복하지 않도록 합니다.
const form = document.getElementById("chat-form");
// 사용자가 텍스트를 입력하는 textarea 요소를 가져옵니다.
const questionField = document.getElementById("question");
// 초기 placeholder 문구를 저장해 두었다가 나중에 복원합니다.
const originalPlaceholder = questionField.getAttribute("placeholder");
// 메시지를 전송하는 버튼 요소를 가져옵니다.
const submitButton = document.getElementById("send");
// 채팅 메시지를 출력하는 UL 요소를 가져옵니다.
const messagesList = document.getElementById("messages");
// 루트 문서 요소를 참조하여 CSS 커스텀 속성을 제어합니다.
const root = document.documentElement;
// 로컬 스토리지에 대화를 저장할 때 사용할 키 값을 정의합니다.
const STORAGE_KEY = "walkwithme:conversation";
// 주소창 애니메이션과 키보드 등장 시 기준이 되는 뷰포트 높이를 추적합니다.
let baselineViewportHeight = window.innerHeight;
// 카카오톡 인앱 브라우저 여부를 간단히 판별합니다.
const isKakaoInApp = /KAKAOTALK/i.test(navigator.userAgent || "");
// Android Chrome 계열인지 빠르게 확인해 주소창 보정을 적용합니다.
const userAgent = navigator.userAgent || "";
const isAndroidChrome = !isKakaoInApp && /Android/i.test(userAgent) && /Chrome/i.test(userAgent);
// 안드로이드 크롬에서 가상 키보드 활성화 상태를 추적합니다.
let androidKeyboardActive = false;
let androidKeyboardViewportHeight = null;

if (isKakaoInApp) {
  document.body.classList.add("is-kakao-inapp");
}

if (isAndroidChrome) {
  document.body.classList.add("is-android-chrome");
}

// 시스템 프롬프트는 모델의 기본 역할과 말투를 지정하는 초기 메시지입니다.
const systemPrompt = {
  // 메시지 역할을 시스템으로 설정합니다.
  role: "system",
  // 여러 안내 문장을 배열로 정의한 후 join으로 하나의 문자열로 합칩니다.
  content: [
    "당신은 노인분들을 따뜻하게 위로하고 경청하는 친근한 친구이자 모든분야 박사급 전문가입니다.",
    "대화는 반말을 사용하고, 상대의 이름·나이·가족·건강 정보 등 이전에 들은 사실을 기억해 이어서 이야기하세요.",
    "답변은 3~4문장으로 차분하게 마무리 질문을 포함하세요.",
  ].join(" "),
};

// 현재까지의 대화를 배열로 보관하며 시스템 프롬프트로 초기화합니다.
let conversation = [systemPrompt];

// 스크롤 위치를 최신 메시지로 맞추는 함수입니다.
function scrollToBottom({ smooth = true } = {}) {
  // 스크롤 애니메이션을 부드럽게 할지 여부를 옵션으로 받습니다.
  const behavior = smooth ? "smooth" : "auto";

  // 즉시 스크롤을 가장 아래로 내립니다.
  messagesList.scrollTop = messagesList.scrollHeight;

  // requestAnimationFrame 이후에도 한번 더 스크롤을 보정합니다.
  requestAnimationFrame(() => {
    messagesList.scrollTop = messagesList.scrollHeight;
    // 마지막 메시지를 화면 하단에 보이도록 스크롤합니다.
    messagesList.lastElementChild?.scrollIntoView({ behavior, block: "end" });
  });
}

// 뷰포트 변화를 감지해 CSS 변수 값을 갱신하는 함수입니다.
function updateViewportVars() {
  // 모바일 환경에서 키보드 높이를 측정하기 위해 visualViewport를 사용합니다.
  const viewport = window.visualViewport;

  if (viewport) {
    if (isKakaoInApp) {
      // 카카오 인앱 브라우저는 키보드 공간을 자체 처리하므로 추가 보정이 필요 없습니다.
      root.style.setProperty("--app-height", `${viewport.height}px`);
      root.style.setProperty("--keyboard-offset", "0px");
      root.style.setProperty("--viewport-offset-left", `${viewport.offsetLeft || 0}px`);
      root.style.setProperty("--viewport-offset-top", "0px");
      return;
    }

    const viewportHeight = viewport.height;
    baselineViewportHeight = Math.max(baselineViewportHeight, window.innerHeight, viewportHeight);
    const rawKeyboardOffset = Math.max(baselineViewportHeight - viewportHeight, 0);
    // 안드로이드 크롬은 주소창 숨김/표시만으로도 높이가 60px 내외로 변하므로, 실키보드보다 작은 변화는 무시합니다.
    const keyboardThreshold = isAndroidChrome ? 110 : 80;
    if (isAndroidChrome) {
      const wasActive = androidKeyboardActive;
      if (rawKeyboardOffset > keyboardThreshold) {
        androidKeyboardActive = true;
      } else if (androidKeyboardActive && rawKeyboardOffset < 30) {
        androidKeyboardActive = false;
      }

      if (androidKeyboardActive) {
        // 키보드가 활성화된 최초 시점의 뷰포트 높이를 기록하고, 이후에는 더 작은 값만 허용해 레이아웃이 길어지지 않도록 고정합니다.
        if (!wasActive || androidKeyboardViewportHeight === null) {
          androidKeyboardViewportHeight = viewportHeight;
        } else {
          androidKeyboardViewportHeight = Math.min(androidKeyboardViewportHeight, viewportHeight);
        }
      } else {
        androidKeyboardViewportHeight = null;
      }

      document.body.classList.toggle("is-android-keyboard", androidKeyboardActive);
    }

    let keyboardOffset = rawKeyboardOffset > keyboardThreshold ? rawKeyboardOffset : 0;
    let appHeight = baselineViewportHeight;

    if (isAndroidChrome && androidKeyboardActive) {
      // 키보드가 올라왔을 때 전체 기기 높이가 줄어든 것처럼 보이도록, 뷰포트 실제 높이를 그대로 사용합니다.
  const lockedHeight = androidKeyboardViewportHeight ?? viewportHeight;
  appHeight = Math.min(lockedHeight, viewportHeight);
      keyboardOffset = 0;
    } else if (keyboardOffset > 0) {
      // 다른 브라우저에서는 기존과 동일하게 살짝 덜 밀어 올려 과도한 여백을 방지합니다.
      const reducedOffset = Math.max(keyboardOffset - 90, 0);
      const scaledOffset = keyboardOffset * 0.45;
      keyboardOffset = Math.max(Math.min(reducedOffset, scaledOffset), 48);
    }

  const usingReducedViewport = isAndroidChrome && androidKeyboardActive;
  const topOffset = usingReducedViewport ? 0 : keyboardOffset > 0 ? 0 : viewport.offsetTop || 0;
    root.style.setProperty("--app-height", `${appHeight}px`);
    root.style.setProperty("--keyboard-offset", `${keyboardOffset}px`);
    root.style.setProperty("--viewport-offset-left", `${viewport.offsetLeft || 0}px`);
    root.style.setProperty("--viewport-offset-top", isAndroidChrome ? `${topOffset}px` : "0px");
  } else {
    if (isKakaoInApp) {
      root.style.setProperty("--app-height", `${window.innerHeight}px`);
      root.style.setProperty("--keyboard-offset", "0px");
      root.style.setProperty("--viewport-offset-left", "0px");
      root.style.setProperty("--viewport-offset-top", "0px");
      return;
    }

    baselineViewportHeight = Math.max(baselineViewportHeight, window.innerHeight);
    const keyboardOffset = Math.max(baselineViewportHeight - window.innerHeight, 0);
    root.style.setProperty("--app-height", `${baselineViewportHeight}px`);
    root.style.setProperty("--keyboard-offset", `${keyboardOffset}px`);
    root.style.setProperty("--viewport-offset-left", "0px");
    root.style.setProperty("--viewport-offset-top", "0px");
  }
}

// 역할에 따라 메시지 DOM 요소를 만들어 반환하는 함수입니다.
function createBubble(role, text) {
  // 각 메시지를 감싸는 li 요소를 생성합니다.
  const item = document.createElement("li");
  // 사용자/어시스턴트 구분을 위한 클래스명을 지정합니다.
  item.className = `message message--${role}`;

  // 프로필 이미지를 대체하는 이모지를 담을 span 요소를 생성합니다.
  const avatar = document.createElement("span");
  avatar.className = "message__avatar";
  // 보조 기술이 읽지 않도록 aria-hidden 속성을 true로 설정합니다.
  avatar.setAttribute("aria-hidden", "true");
  // 사용자와 친구에 따라 다른 이모지를 보여줍니다.
  avatar.textContent = role === "user" ? "🙂" : "😊";

  // 실제 말풍선을 구성할 div 요소를 생성합니다.
  const bubble = document.createElement("div");
  bubble.className = "message__bubble";

  // 말풍선 상단에 표시될 화자 이름을 span 요소로 만듭니다.
  const meta = document.createElement("span");
  meta.className = "message__meta";
  // 사용자일 때는 "나", 친구일 때는 "친구"를 표시합니다.
  meta.textContent = role === "user" ? "나" : "친구";

  // 실제 메시지 텍스트를 담을 p 요소를 생성합니다.
  const body = document.createElement("p");
  body.className = "message__text";
  body.textContent = text;

  // 화자 이름과 본문을 말풍선 안에 순서대로 추가합니다.
  bubble.append(meta, body);

  if (role === "user") {
    // 사용자의 메시지는 말풍선을 먼저, 아바타를 나중에 추가하여 오른쪽 정렬합니다.
    item.append(bubble, avatar);
  } else {
    // 친구의 메시지는 아바타 다음에 말풍선을 추가하여 왼쪽 정렬합니다.
    item.append(avatar, bubble);
  }

  // 완성된 li 요소를 호출자에게 반환합니다.
  return item;
}

// 새로운 메시지를 리스트에 추가하고 자동 스크롤을 실행합니다.
function appendMessage(role, text) {
  // 역할과 내용에 맞춰 생성한 말풍선을 목록에 붙입니다.
  messagesList.appendChild(createBubble(role, text));
  // 최신 메시지가 보이도록 아래로 스크롤합니다.
  scrollToBottom();
}

// 현재 대화 내용을 로컬 스토리지에 안전하게 저장합니다.
function persistConversation() {
  try {
    // 시스템 프롬프트를 제외한 최근 대화만 저장해 용량을 관리합니다.
    const history = conversation.filter((msg) => msg.role !== "system").slice(-MAX_HISTORY * 2);
    // 로컬 스토리지가 없거나 접근이 불가능한 환경을 대비합니다.
    if (!window?.localStorage) {
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages: history })
    );
  } catch (error) {
    // 저장 중 문제가 생겨도 앱 동작은 유지하고 콘솔에만 경고합니다.
    console.warn("대화를 저장하지 못했어요:", error);
  }
}

// 저장된 대화가 있다면 불러와 화면과 메모리에 반영합니다.
function hydrateConversation() {
  try {
    if (!window?.localStorage) {
      return;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    const storedMessages = Array.isArray(parsed?.messages)
      ? parsed.messages.filter((msg) => typeof msg?.role === "string" && typeof msg?.content === "string")
      : [];

    if (!storedMessages.length) {
      return;
    }

    const limitedMessages = storedMessages.slice(-MAX_HISTORY * 2);
    conversation = [systemPrompt, ...limitedMessages];

    messagesList.innerHTML = "";
    limitedMessages.forEach(({ role, content }) => {
      messagesList.appendChild(createBubble(role, content));
    });

    scrollToBottom({ smooth: false });
  } catch (error) {
    console.warn("저장된 대화를 불러오지 못했어요:", error);
  }
}

// 서버에 보낼 메시지 배열을 구성합니다.
function buildPayload() {
  // 최신 대화 MAX_HISTORY 쌍만 남기도록 잘라냅니다.
  const history = conversation.slice(-MAX_HISTORY * 2); // keep both user and assistant pairs
  // 시스템 프롬프트와 함께 사용자/어시스턴트 메시지만 배열로 반환합니다.
  return [systemPrompt, ...history.filter((msg) => msg.role !== "system")];
}

// API 호출을 통해 어시스턴트의 답변을 요청합니다.
async function requestReply(historyMessages) {
  // 요청을 타임아웃 처리하기 위해 AbortController를 사용합니다.
  const controller = new AbortController();
  // 30초 후 요청을 취소하도록 타이머를 설정합니다.
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    // fetch로 POST 요청을 날려 대화 이력을 전송합니다.
    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        messages: historyMessages,
      }),
    });

    if (!res.ok) {
      // 서버가 오류 응답을 돌려준 경우 메시지를 추출합니다.
      const errorPayload = await res.json().catch(() => null);
      throw new Error(errorPayload?.error || `응답 코드 ${res.status}`);
    }

    // 정상 응답일 경우 JSON을 파싱해 OpenAI 형식의 데이터를 획득합니다.
    const data = await res.json();
    // 첫 번째 선택지의 메시지 내용을 깨끗하게 다듬어 반환합니다.
    return data?.choices?.[0]?.message?.content?.trim();
  } finally {
    // 요청이 끝나면 타임아웃 타이머를 해제해 메모리 누수를 막습니다.
    clearTimeout(timeout);
  }
}

// 입력창 높이를 내용에 맞게 자동 조절합니다.
function handleComposerResize() {
  // 높이를 먼저 auto로 초기화하여 스크롤 높이를 정확히 계산합니다.
  questionField.style.height = "auto";
  // textarea의 실제 scrollHeight를 기준으로 최대 180px까지 늘립니다.
  questionField.style.height = `${Math.min(questionField.scrollHeight, 180)}px`;
}

// 페이지 로드 시점에 뷰포트 관련 CSS 변수를 초기화합니다.
updateViewportVars();

// 이전 대화가 저장되어 있다면 불러와서 화면에 표시합니다.
hydrateConversation();

// 뷰포트 변경 시 실행할 콜백을 화살표 함수로 정의합니다.
const handleViewportChange = () => {
  // 우선 최신 뷰포트 값을 반영합니다.
  updateViewportVars();
  // 스크롤 애니메이션 없이 바로 하단으로 이동시킵니다.
  scrollToBottom({ smooth: false });
};

// 창 크기가 변경될 때마다 뷰포트 갱신 함수를 호출합니다.
window.addEventListener("resize", handleViewportChange);
// 기기 방향이 바뀔 때도 동일하게 처리합니다.
window.addEventListener("orientationchange", handleViewportChange);

// visualViewport가 지원되는 환경에서는 세밀한 이벤트를 추가로 감지합니다.
if (window.visualViewport) {
  // 뷰포트 크기가 달라지면 콜백을 실행합니다.
  window.visualViewport.addEventListener("resize", handleViewportChange);
  // 모바일에서 키보드가 열릴 때 발생하는 스크롤도 감지합니다.
  window.visualViewport.addEventListener("scroll", handleViewportChange);
}

// 사용자가 입력할 때마다 textarea 높이를 조절합니다.
questionField.addEventListener("input", handleComposerResize);

// 입력창에 포커스가 오면 키보드 대비 스크롤을 부드럽게 맞춰줍니다.
questionField.addEventListener("focus", () => {
  setTimeout(() => {
    updateViewportVars();
    scrollToBottom({ smooth: true });
  }, 120);
});

// 포커스가 사라질 때도 약간의 지연 후 스크롤을 재조정합니다.
questionField.addEventListener("blur", () => {
  setTimeout(() => {
    updateViewportVars();
    scrollToBottom({ smooth: false });
  }, 120);
});

// Ctrl+Enter 또는 Cmd+Enter를 누르면 메시지를 전송하도록 처리합니다.
questionField.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    form.requestSubmit();
  }
});

// 폼 전송 이벤트를 가로채 비동기 처리합니다.
form.addEventListener("submit", async (event) => {
  // 기본 제출 동작을 막아 페이지 새로고침을 방지합니다.
  event.preventDefault();

  // 입력된 텍스트에서 앞뒤 공백을 제거합니다.
  const content = questionField.value.trim();
  if (!content) {
    // 내용이 없으면 입력창에 포커스를 다시 주고 종료합니다.
    questionField.focus();
    return;
  }

  // 방금 작성한 사용자 메시지를 대화 배열에 추가합니다.
  const userMessage = { role: "user", content };
  conversation.push(userMessage);
  // 사용자 메시지를 즉시 화면에 표시합니다.
  appendMessage("user", content);
  // 최신 대화를 저장해 다음 방문 시 이어서 볼 수 있게 합니다.
  persistConversation();

  // 응답을 기다리는 동안 전송 버튼을 비활성화합니다.
  submitButton.disabled = true;
  // 생각중 상태에서는 입력창 자체도 비활성화해 추가 입력을 막습니다.
  questionField.disabled = true;
  // 사용자가 기다리는 상황임을 안내하는 placeholder 문구로 교체합니다.
  questionField.setAttribute("placeholder", "친구가 답변을 생각하고 있어. 잠시 기다려줘");
  // 잠금 상태 스타일을 적용해 사용자에게 입력 불가임을 알립니다.
  form.classList.add("composer--locked");
  // textarea 내용을 비우고 높이를 다시 계산합니다.
  questionField.value = "";
  handleComposerResize();

  // "생각중" 상태를 나타내는 임시 말풍선을 만듭니다.
  const thinkingBubble = createBubble("assistant", "생각중…");
  // 스타일 구분을 위해 생각중 클래스를 부여합니다.
  thinkingBubble.classList.add("message--thinking");
  // 임시 말풍선을 메시지 목록에 추가합니다.
  messagesList.appendChild(thinkingBubble);
  // 사용자가 기다리는 동안 최신 위치를 보여줍니다.
  scrollToBottom();

  try {
    // 서버에 대화 이력을 보내고 응답을 기다립니다.
    const reply = await requestReply(buildPayload());
    // 응답이 도착하면 임시 말풍선을 제거합니다.
    messagesList.removeChild(thinkingBubble);

    if (reply) {
      // 어시스턴트의 실제 답변을 대화 배열에 추가합니다.
      const assistantMessage = { role: "assistant", content: reply };
      conversation.push(assistantMessage);
      // 답변을 화면에 출력합니다.
      appendMessage("assistant", reply);
      // 갱신된 대화를 저장합니다.
      persistConversation();
    } else {
      // 응답이 비어있다면 에러 메시지를 대신 보여줍니다.
      appendMessage("assistant", "미안. 지금은 답변을 가져오지 못했어. 잠시 후 다시 시도해 줄래.");
    }
  } catch (error) {
    // 오류가 나면 임시 말풍선을 제거하여 화면을 정리합니다.
    messagesList.removeChild(thinkingBubble);

    // 디버깅을 위해 에러 내용을 콘솔에 출력합니다.
    console.error('error : ' + JSON.stringify(error))

    // 네트워크 중단과 일반 오류를 구분하여 사용자에게 안내합니다.
    appendMessage(
      "assistant",
      error.name === "AbortError"
        ? "네트워크 연결이 잠시 끊어진 것 같아요. 다시 시도해 주시겠어요?"
        : `죄송해요. 오류가 발생했어요: ${error.message}`
    );
  } finally {
    // 요청 완료 후 전송 버튼을 다시 활성화합니다.
    submitButton.disabled = false;
    // 입력창 잠금을 해제하고 다시 입력할 수 있도록 합니다.
    questionField.disabled = false;
    // 원래 placeholder 문구를 되돌려 사용자가 다시 입력할 수 있게 합니다.
    questionField.setAttribute("placeholder", originalPlaceholder);
    form.classList.remove("composer--locked");
  }
});
