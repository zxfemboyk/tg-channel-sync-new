require("dotenv").config();

const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");
const { Telegraf } = require("telegraf");

const { loadPosts, addPost, updatePost, deletePost } = require("./store");
const { saveTelegramFile, MEDIA_DIR } = require("./media");

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_USERNAME = (process.env.CHANNEL_USERNAME || "").replace(/^@/, "");
const PORT = process.env.PORT || 3000;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";

if (!BOT_TOKEN) {
  console.error("Не задан BOT_TOKEN. Создай .env на основе .env.example.");
  process.exit(1);
}

// ---------- Express + WebSocket ----------

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/media", express.static(MEDIA_DIR));

app.get("/api/posts", (req, res) => {
  res.json(loadPosts());
});

const server = app.listen(PORT, () => {
  console.log(`Сайт запущен: http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1 /* OPEN */) {
      client.send(message);
    }
  });
}

// ---------- Telegram Bot ----------

const bot = new Telegraf(BOT_TOKEN);

function channelMatches(chat) {
  if (!CHANNEL_USERNAME) return true; // фильтр не задан — принимаем любой канал, где бот админ
  return (chat.username || "").toLowerCase() === CHANNEL_USERNAME.toLowerCase();
}

/**
 * Превращает сообщение Telegram в объект поста для сайта.
 * Скачивает медиа (фото/видео/документ), если есть.
 */
async function buildPost(ctx, msg) {
  const post = {
    messageId: msg.message_id,
    channelId: msg.chat.id,
    channelTitle: msg.chat.title || msg.chat.username || "Канал",
    date: new Date(msg.date * 1000).toISOString(),
    text: msg.text || msg.caption || "",
    media: null,
    mediaType: null,
    source: "live", // помечаем, что пост пришёл напрямую от бота (в отличие от импортированных)
  };

  try {
    if (msg.photo && msg.photo.length) {
      const best = msg.photo[msg.photo.length - 1]; // самое большое разрешение
      post.media = await saveTelegramFile(bot, best.file_id, ".jpg");
      post.mediaType = "photo";
    } else if (msg.video) {
      post.media = await saveTelegramFile(bot, msg.video.file_id, ".mp4");
      post.mediaType = "video";
    } else if (msg.animation) {
      post.media = await saveTelegramFile(bot, msg.animation.file_id, ".mp4");
      post.mediaType = "animation";
    } else if (msg.document) {
      const ext = path.extname(msg.document.file_name || "") || "";
      post.media = await saveTelegramFile(bot, msg.document.file_id, ext);
      post.mediaType = "document";
      post.mediaName = msg.document.file_name || "Файл";
    }
  } catch (err) {
    console.error("Ошибка скачивания медиа:", err);
  }

  return post;
}

// Новый пост в канале
bot.on("channel_post", async (ctx) => {
  const msg = ctx.channelPost;
  if (!channelMatches(msg.chat)) return;

  const post = await buildPost(ctx, msg);
  let posts = loadPosts();
  posts = addPost(posts, post);
  broadcast("new_post", post);
  console.log("Новый пост:", post.messageId, post.text.slice(0, 60));
});

// Отредактированный пост в канале
bot.on("edited_channel_post", async (ctx) => {
  const msg = ctx.update.edited_channel_post;
  if (!channelMatches(msg.chat)) return;

  const patch = { text: msg.text || msg.caption || "" };
  let posts = loadPosts();
  posts = updatePost(posts, msg.message_id, patch);
  broadcast("update_post", { messageId: msg.message_id, ...patch });
  console.log("Пост отредактирован:", msg.message_id);
});

// Команда /start в личных сообщениях с ботом — помогает узнать свой chat id,
// который нужно вписать в ADMIN_CHAT_ID (.env), чтобы включить проверку удалённых постов.
bot.start((ctx) => {
  ctx.reply(
    `Твой chat id: ${ctx.chat.id}\n\nВпиши его в файл .env в строку ADMIN_CHAT_ID, чтобы сайт мог отслеживать удалённые посты.`
  );
});

bot.launch().then(() => {
  console.log("Бот запущен и слушает канал (long polling).");
  if (!ADMIN_CHAT_ID) {
    console.log(
      "ADMIN_CHAT_ID не задан — проверка удалённых постов выключена. Напиши боту /start в личку, чтобы узнать свой chat id."
    );
  } else {
    startDeletionCheck();
  }
});

// ---------- Проверка удалённых постов ----------
//
// Telegram Bot API не присылает событие "пост удалён", поэтому проверяем
// сами: пытаемся скопировать сообщение самому себе (ADMIN_CHAT_ID) и сразу
// удаляем копию. Если копирование не удалось с ошибкой "не найдено" —
// значит пост удалили в канале, убираем его и у нас.

const DELETE_CHECK_INTERVAL_MS = 3 * 60 * 1000; // раз в 3 минуты
const DELETE_CHECK_BATCH_SIZE = 25; // не больше N постов за один проход
const DELETE_CHECK_DELAY_MS = 1200; // пауза между проверками, чтобы не упереться в лимиты Telegram

let deleteCheckCursor = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeDeleted(err) {
  const text = (err && err.description) || (err && err.message) || "";
  const lower = text.toLowerCase();
  return (
    lower.includes("message to copy not found") ||
    lower.includes("message to forward not found") ||
    lower.includes("message_id_invalid") ||
    lower.includes("message not found")
  );
}

async function checkDeletedPosts() {
  const posts = loadPosts().filter((p) => p.source === "live"); // историю, загруженную импортом, не трогаем
  if (posts.length === 0) return;

  const batch = [];
  for (let i = 0; i < Math.min(DELETE_CHECK_BATCH_SIZE, posts.length); i++) {
    batch.push(posts[(deleteCheckCursor + i) % posts.length]);
  }
  deleteCheckCursor = (deleteCheckCursor + batch.length) % posts.length;

  for (const post of batch) {
    try {
      const copied = await bot.telegram.copyMessage(ADMIN_CHAT_ID, post.channelId, post.messageId, {
        disable_notification: true,
      });
      // пост существует — удаляем служебную копию и идём дальше
      await bot.telegram.deleteMessage(ADMIN_CHAT_ID, copied.message_id).catch(() => {});
    } catch (err) {
      if (looksLikeDeleted(err)) {
        let current = loadPosts();
        current = deletePost(current, post.messageId);
        broadcast("delete_post", { messageId: post.messageId });
        console.log("Пост удалён в канале, убрал с сайта:", post.messageId);
      } else {
        console.error("Не удалось проверить пост", post.messageId, err.description || err.message);
      }
    }
    await sleep(DELETE_CHECK_DELAY_MS);
  }
}

function startDeletionCheck() {
  checkDeletedPosts().catch((err) => console.error("Ошибка проверки удалённых постов:", err));
  setInterval(() => {
    checkDeletedPosts().catch((err) => console.error("Ошибка проверки удалённых постов:", err));
  }, DELETE_CHECK_INTERVAL_MS);
}

// Корректное завершение
process.once("SIGINT", () => {
  bot.stop("SIGINT");
  server.close();
});
process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
  server.close();
});
