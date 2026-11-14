
const axios = require("axios");
const config = require("../config/config");
const subscribers = require("../utils/subscribers");
const { log } = require("../utils/logger");

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const API = `https://api.telegram.org/bot${config.telegram.token}`;

let offset = 0;
let running = false;

async function sendReply(chatId, text) {
  await axios.post(
    `${API}/sendMessage`,
    {
      chat_id: chatId,
      text
    },
    { timeout: 15000 }
  );
}

async function handleCommand(message) {
  if (!message?.chat?.id) return;

  // Chỉ cho đăng ký trong chat riêng
  if (message.chat.type !== "private") return;

  const chatId = String(message.chat.id);

  const rawText = (message.text || "").trim();

  const command = rawText
    .split(/\s+/)[0]
    .split("@")[0]
    .toLowerCase();

  switch (command) {
    case "/start": {
      const added = subscribers.addSubscriber(chatId);

      await sendReply(
        chatId,
        added
          ? [
              "✅ ĐĂNG KÝ THÀNH CÔNG",
              "",
              "🚀 Binance Futures Scanner",
              "",
              "Bạn sẽ nhận cảnh báo khi coin Futures tăng vượt ngưỡng.",
              "",
              "📊 RSI(14) 1H",
              "💸 Funding Rate",
              "📈 Basis",
              "📚 Order Book ±10%",
              "",
              "⏹ /stop - Ngừng nhận cảnh báo",
              "📊 /status - Trạng thái"
            ].join("\n")
          : "✅ Bạn đã đăng ký nhận cảnh báo trước đó."
      );
      break;
    }

    case "/stop": {
      const removed =
        subscribers.removeSubscriber(chatId);

      await sendReply(
        chatId,
        removed
          ? "🛑 Đã hủy đăng ký. Bạn sẽ không nhận cảnh báo mới."
          : "Bạn hiện chưa đăng ký nhận cảnh báo."
      );
      break;
    }

    case "/status": {
      const active =
        subscribers.hasSubscriber(chatId);

      await sendReply(
        chatId,
        [
          "📊 TRẠNG THÁI BINANCE SCANNER",
          "",
          active
            ? "🟢 Đang nhận cảnh báo"
            : "🔴 Chưa đăng ký",
          "",
          active
            ? "Dùng /stop để hủy."
            : "Dùng /start để đăng ký."
        ].join("\n")
      );
      break;
    }

    case "/help": {
      await sendReply(
        chatId,
        [
          "🤖 HƯỚNG DẪN SỬ DỤNG",
          "",
          "/start - Đăng ký cảnh báo",
          "/stop - Hủy đăng ký",
          "/status - Kiểm tra trạng thái",
          "/help - Xem hướng dẫn"
        ].join("\n")
      );
      break;
    }

    default:
      // Không phản hồi tin nhắn thông thường
      break;
  }
}

async function startTelegramBot() {
  if (running) return;

  running = true;
  log("🤖 Telegram Bot đang lắng nghe /start");

  while (running) {
    try {
      const response = await axios.get(
        `${API}/getUpdates`,
        {
          params: {
            offset,
            timeout: 25,
            allowed_updates: JSON.stringify([
              "message"
            ])
          },
          timeout: 35000
        }
      );

      const updates = response.data.result || [];

      for (const update of updates) {
        // Ghi nhận offset để tránh xử lý lặp
        offset = update.update_id + 1;

        try {
          await handleCommand(update.message);
        } catch (error) {
          log(
            `Telegram command lỗi: ${error.message}`
          );
        }
      }
    } catch (error) {
      const status = error.response?.status;

      log(
        `Telegram polling lỗi (${status || "network"}): ` +
        error.message
      );

      if (status === 409) {
        log(
          "⚠️ Có webhook hoặc tiến trình getUpdates khác đang dùng bot này"
        );
      }

      await sleep(5000);
    }
  }
}

module.exports = {
  startTelegramBot
};
