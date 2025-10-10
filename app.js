const API_ENDPOINT = "https://walkwithme-api.yama5993.workers.dev/";
const MAX_HISTORY = 12; // user+assistant pairs (excluding system message)

const form = document.getElementById("chat-form");
const questionField = document.getElementById("question");
const submitButton = document.getElementById("send");
const messagesList = document.getElementById("messages");
const root = document.documentElement;

const systemPrompt = {
  role: "system",
  content: [
    "당신은 노인분들을 따뜻하게 위로하고 경청하는 친근한 친구이자 모든분야 박사급 전문가입니다.",
    "대화는 반말을 사용하고, 상대의 이름·나이·가족·건강 정보 등 이전에 들은 사실을 기억해 이어서 이야기하세요.",
    "답변은 3~4문장으로 차분하게 마무리 질문을 포함하세요.",
  ].join(" "),
};

let conversation = [systemPrompt];

function scrollToBottom({ smooth = true } = {}) {
  const behavior = smooth ? "smooth" : "auto";

  messagesList.scrollTop = messagesList.scrollHeight;

  requestAnimationFrame(() => {
    messagesList.scrollTop = messagesList.scrollHeight;
    messagesList.lastElementChild?.scrollIntoView({ behavior, block: "end" });
  });
}

function updateViewportVars() {
  const viewport = window.visualViewport;

  if (viewport) {
    const keyboardOffset = Math.max(window.innerHeight - viewport.height - viewport.offsetTop, 0);
    root.style.setProperty("--app-height", `${viewport.height}px`);
    root.style.setProperty("--keyboard-offset", `${keyboardOffset}px`);
  } else {
    root.style.setProperty("--app-height", `${window.innerHeight}px`);
    root.style.setProperty("--keyboard-offset", "0px");
  }
}

function createBubble(role, text) {
  const item = document.createElement("li");
  item.className = `message message--${role}`;

  const avatar = document.createElement("span");
  avatar.className = "message__avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "user" ? "🙂" : "😊";

  const bubble = document.createElement("div");
  bubble.className = "message__bubble";

  const meta = document.createElement("span");
  meta.className = "message__meta";
  meta.textContent = role === "user" ? "나" : "친구";

  const body = document.createElement("p");
  body.className = "message__text";
  body.textContent = text;

  bubble.append(meta, body);

  if (role === "user") {
    item.append(bubble, avatar);
  } else {
    item.append(avatar, bubble);
  }

  return item;
}

function appendMessage(role, text) {
  messagesList.appendChild(createBubble(role, text));
  scrollToBottom();
}

function buildPayload() {
  const history = conversation.slice(-MAX_HISTORY * 2); // keep both user and assistant pairs
  return [systemPrompt, ...history.filter((msg) => msg.role !== "system")];
}

async function requestReply(historyMessages) {
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
      const errorPayload = await res.json().catch(() => null);
      throw new Error(errorPayload?.error || `응답 코드 ${res.status}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim();
  } finally {
    clearTimeout(timeout);
  }
}

function handleComposerResize() {
  questionField.style.height = "auto";
  questionField.style.height = `${Math.min(questionField.scrollHeight, 180)}px`;
}

updateViewportVars();

const handleViewportChange = () => {
  updateViewportVars();
  scrollToBottom({ smooth: false });
};

window.addEventListener("resize", handleViewportChange);
window.addEventListener("orientationchange", handleViewportChange);

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", handleViewportChange);
  window.visualViewport.addEventListener("scroll", handleViewportChange);
}

questionField.addEventListener("input", handleComposerResize);

questionField.addEventListener("focus", () => {
  setTimeout(() => {
    updateViewportVars();
    scrollToBottom({ smooth: true });
  }, 120);
});

questionField.addEventListener("blur", () => {
  setTimeout(() => {
    updateViewportVars();
    scrollToBottom({ smooth: false });
  }, 120);
});

questionField.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    form.requestSubmit();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = questionField.value.trim();
  if (!content) {
    questionField.focus();
    return;
  }

  const userMessage = { role: "user", content };
  conversation.push(userMessage);
  appendMessage("user", content);

  submitButton.disabled = true;
  questionField.value = "";
  handleComposerResize();

  const thinkingBubble = createBubble("assistant", "생각중…");
  thinkingBubble.classList.add("message--thinking");
  messagesList.appendChild(thinkingBubble);
  scrollToBottom();

  try {
    const reply = await requestReply(buildPayload());
    messagesList.removeChild(thinkingBubble);

    if (reply) {
      const assistantMessage = { role: "assistant", content: reply };
      conversation.push(assistantMessage);
      appendMessage("assistant", reply);
    } else {
      appendMessage("assistant", "죄송해요. 지금은 답변을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  } catch (error) {
    messagesList.removeChild(thinkingBubble);

    console.error('error : ' + JSON.stringify(error))

    appendMessage(
      "assistant",
      error.name === "AbortError"
        ? "네트워크 연결이 잠시 끊어진 것 같아요. 다시 시도해 주시겠어요?"
        : `죄송해요. 오류가 발생했어요: ${error.message}`
    );
  } finally {
    submitButton.disabled = false;
    questionField.focus();
  }
});
