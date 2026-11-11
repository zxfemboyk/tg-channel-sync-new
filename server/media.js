// Скачивание медиа из Telegram и сохранение в /media,
// чтобы сайт отдавал файлы сам (не завязываясь на токен бота в публичных ссылках).

const fs = require("fs");
const path = require("path");
const https = require("https");

const MEDIA_DIR = path.join(__dirname, "..", "media");

function ensureMediaDir() {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Не удалось скачать файл: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

/**
 * Скачивает файл из Telegram по file_id и возвращает публичный путь (/media/...)
 */
async function saveTelegramFile(bot, fileId, extHint) {
  ensureMediaDir();
  const file = await bot.telegram.getFile(fileId);
  const filePath = file.file_path; // например photos/file_1.jpg
  const ext = extHint || path.extname(filePath) || "";
  const localName = `${fileId}${ext}`;
  const localPath = path.join(MEDIA_DIR, localName);

  if (!fs.existsSync(localPath)) {
    const url = `https://api.telegram.org/file/bot${bot.token}/${filePath}`;
    await download(url, localPath);
  }

  return `/media/${localName}`;
}

module.exports = { saveTelegramFile, MEDIA_DIR };
