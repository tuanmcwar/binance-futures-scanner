
const fs = require("fs");
const path = require("path");

const DATA_DIR =
  process.env.DATA_DIR ||
  path.resolve(__dirname, "../../data");

const FILE_PATH = path.join(
  DATA_DIR,
  "subscribers.json"
);

let subscribers = new Set();

function saveSubscribers() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const tempFile = FILE_PATH + ".tmp";

  fs.writeFileSync(
    tempFile,
    JSON.stringify(
      {
        version: 1,
        subscribers: [...subscribers]
      },
      null,
      2
    ),
    "utf8"
  );

  fs.renameSync(tempFile, FILE_PATH);
}

function loadSubscribers() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(FILE_PATH)) {
    subscribers = new Set();
    saveSubscribers();
    return;
  }

  // Không tự xóa dữ liệu khi file bị hỏng
  const content = fs.readFileSync(
    FILE_PATH,
    "utf8"
  );

  const data = JSON.parse(content);

  if (!Array.isArray(data.subscribers)) {
    throw new Error(
      "File subscribers.json không hợp lệ"
    );
  }

  subscribers = new Set(
    data.subscribers.map(String)
  );

  console.log(
    `[TELEGRAM] Đã tải ${subscribers.size} người đăng ký`
  );
}

function addSubscriber(chatId) {
  const id = String(chatId);

  if (subscribers.has(id)) return false;

  subscribers.add(id);

  try {
    saveSubscribers();
    return true;
  } catch (error) {
    subscribers.delete(id);
    throw error;
  }
}

function removeSubscriber(chatId) {
  const id = String(chatId);

  if (!subscribers.has(id)) return false;

  subscribers.delete(id);

  try {
    saveSubscribers();
    return true;
  } catch (error) {
    subscribers.add(id);
    throw error;
  }
}

function hasSubscriber(chatId) {
  return subscribers.has(String(chatId));
}

function getSubscribers() {
  return [...subscribers];
}

function getSubscriberCount() {
  return subscribers.size;
}

module.exports = {
  loadSubscribers,
  addSubscriber,
  removeSubscriber,
  hasSubscriber,
  getSubscribers,
  getSubscriberCount
};
