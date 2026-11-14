
const axios = require("axios");
const config = require("../config/config");
const subscribers = require("../utils/subscribers");
const { log } = require("../utils/logger");

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function formatTime(timestamp) {
  if (!timestamp) return "Không có dữ liệu";

  return new Date(timestamp).toLocaleString(
    "vi-VN",
    {
      timeZone: "Asia/Ho_Chi_Minh",
      hour12: false
    }
  );
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "Không có dữ liệu";
  }

  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatPrice(value, digits = 8) {
  if (!Number.isFinite(value)) {
    return "Không có dữ liệu";
  }

  return value.toFixed(digits);
}

function formatPercent(value, digits = 4) {
  if (!Number.isFinite(value)) {
    return "Không có dữ liệu";
  }

  return (
    `${value > 0 ? "+" : ""}` +
    `${value.toFixed(digits)}%`
  );
}

function createKeyboard(symbol) {
  if (!symbol) return undefined;

  return {
    inline_keyboard: [
      [
        {
          text: "📊 Xem biểu đồ CoinGlass",
          url:
            `https://www.coinglass.com/tv/vi/Binance_${symbol}`
        }
      ]
    ]
  };
}

async function sendToChat(chatId, text, symbol) {
  const { token } = config.telegram;

  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  };

  if (symbol) {
    payload.reply_markup = createKeyboard(symbol);
  }

  const url =
    `https://api.telegram.org/bot${token}/sendMessage`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await axios.post(
        url,
        payload,
        { timeout: 15000 }
      );

      return true;
    } catch (error) {
      const status = error.response?.status;
      const errorCode =
        error.response?.data?.error_code;

      // Người dùng chặn bot hoặc chat không còn hợp lệ
      if (status === 403) {
        try {
          subscribers.removeSubscriber(chatId);
          log(`Đã hủy đăng ký chat ${chatId}: 403`);
        } catch (saveError) {
          log(`Lỗi lưu subscriber: ${saveError.message}`);
        }

        return false;
      }

      // Không xóa subscriber nếu chỉ bị lỗi mạng
      if (status === 400) {
        log(
          `Không gửi được chat ${chatId}: ` +
          JSON.stringify(error.response?.data)
        );
        return false;
      }

      if (status === 429) {
        const retryAfter =
          Number(
            error.response?.data?.parameters
              ?.retry_after
          ) || 5;

        log(
          `Telegram rate limit, chờ ${retryAfter}s`
        );

        await sleep(retryAfter * 1000);
        continue;
      }

      if (
        attempt === 3 ||
        (status && status < 500)
      ) {
        log(
          `Gửi Telegram lỗi ${chatId}: ` +
          error.message
        );
        return false;
      }

      await sleep(1000 * attempt);
    }
  }

  return false;
}

// Gửi một thông báo cho tất cả người đăng ký
async function sendMessage(text, symbol = null) {
  const users = subscribers.getSubscribers();

  if (users.length === 0) {
    log("Chưa có người đăng ký Telegram");
    return {
      total: 0,
      success: 0,
      failed: 0
    };
  }

  let success = 0;
  let failed = 0;

  for (const chatId of users) {
    // Người dùng có thể /stop trong khi đang gửi
    if (!subscribers.hasSubscriber(chatId)) {
      continue;
    }

    const sent = await sendToChat(
      chatId,
      text,
      symbol
    );

    if (sent) {
      success++;
    } else {
      failed++;
    }

    // Giới hạn tốc độ gửi, tránh spam Telegram
    await sleep(100);
  }

  log(
    `📨 Telegram: thành công ${success}, ` +
    `thất bại ${failed}`
  );

  return {
    total: users.length,
    success,
    failed
  };
}

async function sendAlert(coin) {
  const fundingRate = coin.funding?.rate;
  const rsi = coin.rsi;
  const basis = coin.basis;
  const book = coin.orderBook;

  const rsiText = Number.isFinite(rsi)
    ? rsi.toFixed(2)
    : "Không có dữ liệu";

  const fundingText = formatPercent(fundingRate);

  let basisLines;

  if (basis) {
    const status =
      basis.basisRate < 0
        ? "🔴 FUTURES THẤP HƠN INDEX"
        : basis.basisRate > 0
          ? "🟢 FUTURES CAO HƠN INDEX"
          : "⚪ FUTURES BẰNG INDEX";

    basisLines = [
      status,
      "",
      `📊 Tỷ lệ chênh lệch: ${formatPercent(basis.basisRate)}`,
      `💰 Giá Futures: ${formatPrice(basis.futuresPrice)}`,
      `📍 Giá Index: ${formatPrice(basis.indexPrice)}`,
      `📉 Chênh lệch giá: ${formatPrice(basis.basis)}`
    ];
  } else {
    basisLines = [
      "📊 THÔNG TIN CHÊNH LỆCH GIÁ",
      "Không có dữ liệu"
    ];
  }

  let orderBookLines;

  if (book) {
    orderBookLines = [
      "📚 ORDER BOOK (±10%)",
      `🟢 BUY Depth: ${formatNumber(book.buyDepth)} USDT`,
      `🔴 SELL Depth: ${formatNumber(book.sellDepth)} USDT`,
      `⚖️ Imbalance: ${formatPercent(book.imbalance, 2)}`
    ];

    if (!book.coverageComplete) {
      orderBookLines.push(
        "⚠️ Snapshot chưa phủ đủ phạm vi ±10%"
      );
    }
  } else {
    orderBookLines = [
      "📚 ORDER BOOK (±10%)",
      "Không có dữ liệu"
    ];
  }

  const message = [
    "🚀 BINANCE FUTURES 1H PUMP ALERT",
    "",
    `🪙 Coin: ${coin.symbol}`,
    `📈 Tăng 1H: +${coin.percent.toFixed(2)}%`,
    "",
    `📊 RSI(14) 1H: ${rsiText}`,
    `💸 Funding Rate: ${fundingText}`,
    "",
    ...basisLines,
    "",
    ...orderBookLines,
    "",
    `🕒 Dữ liệu lấy lúc: ${formatTime(coin.snapshotTime)}`,
    `⏰ Cảnh báo: ${formatTime(Date.now())}`
  ].join("\n");

  return sendMessage(message, coin.symbol);
}

module.exports = {
  sendMessage,
  sendAlert
};
