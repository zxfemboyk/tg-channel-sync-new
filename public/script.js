const feed = document.getElementById("feed");
const emptyState = document.getElementById("empty-state");
const statusEl = document.getElementById("status");

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderMedia(post) {
  if (!post.media) return "";
  if (post.mediaType === "photo") {
    return `<div class="post-media"><img src="${post.media}" alt="" loading="lazy" /></div>`;
  }
  if (post.mediaType === "video" || post.mediaType === "animation") {
    return `<div class="post-media"><video src="${post.media}" controls playsinline></video></div>`;
  }
  if (post.mediaType === "document") {
    return `<a class="post-doc" href="${post.media}" download>📎 ${post.mediaName || "Файл"}</a>`;
  }
  return "";
}

function renderPost(post) {
  const el = document.createElement("article");
  el.className = "post";
  el.dataset.id = post.messageId;
  el.innerHTML = `
    ${renderMedia(post)}
    <div class="post-body">
      ${post.text ? `<p class="post-text">${escapeHtml(post.text)}</p>` : ""}
      <div class="post-meta">${formatDate(post.date)}</div>
    </div>
  `;
  return el;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updatePostText(messageId, text) {
  const node = feed.querySelector(`[data-id="${messageId}"] .post-text`);
  if (node) node.textContent = text;
}

function removePost(messageId) {
  const node = feed.querySelector(`[data-id="${messageId}"]`);
  if (node) node.remove();
  if (feed.querySelectorAll(".post").length === 0) {
    emptyState.style.display = "block";
  }
}

async function loadInitialPosts() {
  try {
    const res = await fetch("/api/posts");
    const posts = await res.json();
    if (posts.length === 0) {
      emptyState.style.display = "block";
      return;
    }
    emptyState.style.display = "none";
    posts.forEach((post) => feed.appendChild(renderPost(post)));
  } catch (err) {
    console.error("Не удалось загрузить посты:", err);
  }
}

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    statusEl.textContent = "онлайн";
    statusEl.className = "status live";
  };

  ws.onclose = () => {
    statusEl.textContent = "переподключение…";
    statusEl.className = "status offline";
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (event) => {
    const { type, payload } = JSON.parse(event.data);
    if (type === "new_post") {
      emptyState.style.display = "none";
      feed.insertBefore(renderPost(payload), feed.firstElementChild);
    } else if (type === "update_post") {
      updatePostText(payload.messageId, payload.text);
    } else if (type === "delete_post") {
      removePost(payload.messageId);
    }
  };
}

loadInitialPosts();
connectWebSocket();
