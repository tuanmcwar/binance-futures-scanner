
require("dotenv").config();
const path = require("path");

module.exports = {
  binanceUrl: "https://fapi.binance.com",

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  },

  scanner: {
    threshold: Number(process.env.PUMP_THRESHOLD ?? 10),
    interval: Number(process.env.SCAN_INTERVAL_MS ?? 10000),
    scanMinute: Number(process.env.SCAN_MINUTE ?? 58),
    symbolRefresh: Number(
      process.env.SYMBOL_REFRESH_MS ?? 1800000
    ),
    concurrency: Number(
      process.env.CANDLE_CONCURRENCY ?? 5
    ),
    rsiPeriod: Number(process.env.RSI_PERIOD ?? 14)
  },

  stateFile: path.join(
    __dirname,
    "../../data/scanner-state.json"
  )
};
