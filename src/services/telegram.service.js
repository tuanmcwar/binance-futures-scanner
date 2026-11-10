
const axios = require("axios");
const config = require("../config/config");

function formatPrice(price) {
  return Number(price).toPrecision(8);
}

function formatTime(timestamp) {
  if (!timestamp) return "Không có dữ liệu";

  return new Date(timestamp).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh"
  });
}

async function sendMessage(text) {
  const { token, chatId } = config.telegram;

  if (!token || !chatId) {
    throw new Error("Thiếu Telegram Token hoặc Chat ID");
  }

  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    },
    { timeout: 15000 }
  );
}

async function sendAlert(coin) {
  const fundingRate = coin.funding?.rate;

  const fundingText = Number.isFinite(fundingRate)
    ? `${fundingRate >= 0 ? "+" : ""}${fundingRate.toFixed(4)}%`
    : "Không có dữ liệu";

  const rsiText = Number.isFinite(coin.rsi)
    ? coin.rsi.toFixed(2)
    : "Không có dữ liệu";

  const message = [
    "🚀 BINANCE FUTURES PUMP ALERT",
    "",
    `🪙 Coin: ${coin.symbol}`,
    `📈 Tăng: +${coin.percent.toFixed(2)}%`,
    "⏱ Khung thời gian: 1H",
    `💰 Giá mở nến: ${formatPrice(coin.open)}`,
    `💵 Giá hiện tại: ${formatPrice(coin.price)}`,
    "",
    `📊 RSI(14) 1H: ${rsiText}`,
    `💸 Funding Rate: ${fundingText}`,
    "",
    `⏰ Cảnh báo: ${formatTime(Date.now())}`,
    `🔗 https://www.coinglass.com/tv/vi/Binance_${coin.symbol}`
  ].join("\n");

  await sendMessage(message);
}

module.exports = {
  sendMessage,
  sendAlert
};
