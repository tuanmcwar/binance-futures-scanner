
const axios = require("axios");
const config = require("../config/config");

function formatTime(timestamp) {
  if (!timestamp) return "Không có dữ liệu";

  return new Date(timestamp).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false
  });
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

  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

async function sendMessage(text, symbol = null) {
  const { token, chatId } = config.telegram;

  if (!token || !chatId) {
    throw new Error("Thiếu Telegram Token hoặc Chat ID");
  }

  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  };

  if (symbol) {
    payload.reply_markup = {
      inline_keyboard: [
        [
          {
            text: "📊 Xem biểu đồ CoinGlass",
            url: `https://www.coinglass.com/tv/vi/Binance_${symbol}`
          }
        ]
      ]
    };
  }

  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    payload,
    { timeout: 15000 }
  );
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
      `📊 Basis Rate: ${formatPercent(basis.basisRate)}`,
      `💰 Futures Price: ${formatPrice(basis.futuresPrice)}`,
      `📍 Index Price: ${formatPrice(basis.indexPrice)}`,
      `📉 Basis: ${formatPrice(basis.basis)}`
    ];
  } else {
    basisLines = [
      "📊 BASIS INFORMATION",
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
    "🚀 BINANCE FUTURES PUMP ALERT",
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
  ].join("\n");

  await sendMessage(message, coin.symbol);
}

module.exports = {
  sendMessage,
  sendAlert
};
