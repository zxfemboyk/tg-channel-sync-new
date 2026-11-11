// Импорт старой истории канала из экспорта Telegram Desktop.
//
// Как получить экспорт: Telegram Desktop → открыть канал → три точки (меню) →
// "Экспортировать историю чата" → отметить только "Фотографии", "Видеофайлы",
// "Файлы", "GIF" и формат "Машиночитаемый JSON" → экспортировать.
// Получится папка с файлом result.json и подпапками photos/, video_files/ и т.д.
//
// Запуск:
//   node server/importHistory.js "C:\путь\к\папке\экспорта"

const fs = require("fs");
const path = require("path");
const { loadPosts, savePosts } = require("./store");
const { MEDIA_DIR } = require("./media");

const exportDir = process.argv[2];

if (!exportDir) {
  console.error("Укажи путь к папке с экспортом истории, например:");
  console.error('  node server/importHistory.js "C:\\Users\\gkiri\\Desktop\\ChatExport"');
  process.exit(1);
}

const resultPath = path.join(exportDir, "result.json");

if (!fs.existsSync(resultPath)) {
  console.error(`Не найден файл result.json внутри ${exportDir}`);
  console.error("Проверь, что указал правильную папку экспорта.");
  process.exit(1);
}

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const raw = fs.readFileSync(resultPath, "utf8");
const data = JSON.parse(raw);

const messages = Array.isArray(data.messages) ? data.messages : [];
console.log(`Найдено сообщений в экспорте: ${messages.length}`);

/**
 * Текст в экспорте Telegram Desktop может быть строкой или массивом
 * "кусочков" (обычный текст + форматированные части) — склеиваем в одну строку.
 */
function extractText(msg) {
  const source = msg.text_entities && msg.text_entities.length ? msg.text_entities : msg.text;
  if (typeof source === "string") return source;
  if (Array.isArray(source)) {
    return source.map((part) => (typeof part === "string" ? part : part.text || "")).join("");
  }
  return "";
}

/**
 * Копирует файл медиа из папки экспорта в нашу папку /media
 * и возвращает публичный путь вида /media/имя.
 */
function copyMedia(relativePath, messageId) {
  const sourcePath = path.join(exportDir, relativePath);
  if (!fs.existsSync(sourcePath)) {
    console.warn(`  медиафайл не найден, пропускаю: ${relativePath}`);
    return null;
  }
  const ext = path.extname(relativePath) || "";
  const localName = `import_${messageId}${ext}`;
  const destPath = path.join(MEDIA_DIR, localName);
  if (!fs.existsSync(destPath)) {
    fs.copyFileSync(sourcePath, destPath);
  }
  return `/media/${localName}`;
}

function buildImportedPost(msg) {
  const post = {
    messageId: msg.id,
    channelId: null, // неизвестен в формате экспорта; для истории это не нужно
    channelTitle: data.name || "Канал",
    date: msg.date ? new Date(msg.date).toISOString() : new Date().toISOString(),
    text: extractText(msg),
    media: null,
    mediaType: null,
    source: "import", // помечаем как импортированное — проверка удаления его не трогает
  };

  if (msg.photo) {
    post.media = copyMedia(msg.photo, msg.id);
    post.mediaType = "photo";
  } else if (msg.file && msg.media_type === "video_file") {
    post.media = copyMedia(msg.file, msg.id);
    post.mediaType = "video";
  } else if (msg.file && msg.media_type === "animation") {
    post.media = copyMedia(msg.file, msg.id);
    post.mediaType = "animation";
  } else if (msg.file) {
    post.media = copyMedia(msg.file, msg.id);
    post.mediaType = "document";
    post.mediaName = path.basename(msg.file);
  }

  return post;
}

const existing = loadPosts();
const existingIds = new Set(existing.map((p) => p.messageId));

let imported = 0;
let skipped = 0;
const newPosts = [];

for (const msg of messages) {
  if (msg.type !== "message") continue; // пропускаем служебные записи (входы/выходы и т.д.)
  if (existingIds.has(msg.id)) {
    skipped++;
    continue;
  }
  const post = buildImportedPost(msg);
  newPosts.push(post);
  existingIds.add(msg.id);
  imported++;
}

// Объединяем и сортируем по дате (новые — первыми), как в остальном приложении
const merged = [...existing, ...newPosts].sort((a, b) => new Date(b.date) - new Date(a.date));

savePosts(merged);

console.log(`Готово. Импортировано новых постов: ${imported}. Пропущено (уже были): ${skipped}.`);
console.log("Перезапусти сайт (npm start), чтобы увидеть обновлённую ленту.");
