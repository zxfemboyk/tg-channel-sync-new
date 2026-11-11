// Простое файловое хранилище постов (JSON).
// Для такого проекта (лента одного канала) этого достаточно —
// не нужна отдельная база данных.

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "posts.json");

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function loadPosts() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Не удалось прочитать posts.json, начинаю с пустого списка:", err);
    return [];
  }
}

function savePosts(posts) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(posts, null, 2), "utf8");
}

function addPost(posts, post) {
  posts.unshift(post); // новые посты — в начало
  // храним последние 2000 постов (с учётом импорта старой истории), чтобы файл не рос бесконечно
  if (posts.length > 2000) posts.length = 2000;
  savePosts(posts);
  return posts;
}

function updatePost(posts, messageId, patch) {
  const idx = posts.findIndex((p) => p.messageId === messageId);
  if (idx === -1) return posts;
  posts[idx] = { ...posts[idx], ...patch };
  savePosts(posts);
  return posts;
}

function deletePost(posts, messageId) {
  const idx = posts.findIndex((p) => p.messageId === messageId);
  if (idx === -1) return posts;
  posts.splice(idx, 1);
  savePosts(posts);
  return posts;
}

module.exports = { loadPosts, savePosts, addPost, updatePost, deletePost };
