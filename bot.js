
require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const CONFIG = {
  baseUrl: "https://fapi.binance.com",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,

  threshold: Number(process.env.PUMP_THRESHOLD ?? 5),
  scanInterval: Number(process.env.SCAN_INTERVAL_MS ?? 10000),
  symbolRefresh: Number(process.env.SYMBOL_REFRESH_MS ?? 1800000),
  concurrency: Number(process.env.CANDLE_CONCURRENCY ?? 5),

  stateFile: path.join(__dirname, "scanner-state.json")
};

const api = axios.create({
  baseURL: CONFIG.baseUrl,
  timeout: 15000
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let symbols = new Set();
let candles = new Map();
let alerted = new Set();
let lastSymbolRefresh = 0;

let serverTimeOffset = 0;
let lastTimeSync = 0;

// ========================================
// 1. TIỆN ÍCH
// ========================================

function log(message) {
  console.log(
    `[${new Date().toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh"
    })}] ${message}`
  );
}

function currentHour() {
  const now = Date.now() + serverTimeOffset;
  return Math.floor(now / 3600000) * 3600000;
}

function formatPrice(value) {
  return Number(value).toPrecision(8);
}

async function request(url, params = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await api.get(url, { params });
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const retryable =
        !status || status === 429 || status >= 500;

      if (!retryable || attempt === 3) {
        throw error;
      }

      const retryAfter = Number(
        error.response?.headers?.["retry-after"] || 0
      );

      const wait = retryAfter > 0
        ? retryAfter * 1000
        : 1000 * 2 ** attempt;

      log(`API lỗi ${status || "NETWORK"}, thử lại sau ${wait}ms`);
      await sleep(wait);
    }
  }
}

// ========================================
// 2. ĐỒNG BỘ THỜI GIAN BINANCE
// ========================================

async function syncServerTime() {
  const before = Date.now();
  const data = await request("/fapi/v1/time");
  const after = Date.now();

  serverTimeOffset =
    Number(data.serverTime) - (before + after) / 2;

  lastTimeSync = Date.now();
}

// ========================================
// 3. LƯU VÀ KHÔI PHỤC CẢNH BÁO
// ========================================

function loadState() {
  if (!fs.existsSync(CONFIG.stateFile)) return;

  try {
    const state = JSON.parse(
      fs.readFileSync(CONFIG.stateFile, "utf8")
    );

    const hour = currentHour();

    alerted = new Set(
      (state.alerted || []).filter(key =>
        key.endsWith(`:${hour}`)
      )
    );

    log(`Khôi phục ${alerted.size} cảnh báo`);
  } catch (error) {
    log(`Không thể đọc state: ${error.message}`);
  }
}

function saveState() {
  const temp = CONFIG.stateFile + ".tmp";

  fs.writeFileSync(
    temp,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      alerted: [...alerted]
    }, null, 2)
  );

  fs.renameSync(temp, CONFIG.stateFile);
}

// ========================================
// 4. LẤY TẤT CẢ COIN USDT FUTURES
// ========================================

async function updateSymbols() {
  const data = await request("/fapi/v1/exchangeInfo");

  const list = data.symbols
    .filter(item =>
      item.status === "TRADING" &&
      item.contractType === "PERPETUAL" &&
      item.quoteAsset === "USDT" &&
      item.marginAsset === "USDT"
    )
    .map(item => item.symbol);

  symbols = new Set(list);
  lastSymbolRefresh = Date.now();

  for (const symbol of candles.keys()) {
    if (!symbols.has(symbol)) {
      candles.delete(symbol);
    }
  }

  log(`Đã cập nhật ${symbols.size} cặp USDT Futures`);
}

// ========================================
// 5. LẤY GIÁ MỞ NẾN 1H
// ========================================

async function getCandle(symbol) {
  const data = await request("/fapi/v1/klines", {
    symbol,
    interval: "1h",
    limit: 2
  });

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Không có dữ liệu nến");
  }

  const last = data[data.length - 1];

  return {
    openTime: Number(last[0]),
    open: Number(last[1])
  };
}

// Chạy nhiều request có giới hạn đồng thời
async function runPool(items, concurrency, worker) {
  let index = 0;

  async function runner() {
    while (index < items.length) {
      const item = items[index++];

      try {
        await worker(item);
      } catch (error) {
        log(`Lỗi ${item}: ${error.message}`);
      }

      await sleep(120);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runner()
    )
  );
}

async function syncCandles() {
  const hour = currentHour();

  const missing = [...symbols].filter(symbol => {
    const candle = candles.get(symbol);
    return !candle || candle.openTime !== hour;
  });

  if (missing.length === 0) return;

  log(`Đang đồng bộ ${missing.length} nến 1H...`);

  await runPool(
    missing,
    CONFIG.concurrency,
    async symbol => {
      const candle = await getCandle(symbol);

      // Chỉ sử dụng nến thuộc giờ hiện tại
      if (candle.openTime === currentHour()) {
        candles.set(symbol, candle);
      }
    }
  );

  // Giữ cảnh báo của giờ hiện tại
  const activeHour = currentHour();

  alerted = new Set(
    [...alerted].filter(key =>
      key.endsWith(`:${activeHour}`)
    )
  );

  saveState();
}

// ========================================
// 6. GỬI TELEGRAM
// ========================================

async function sendTelegram(message) {
  const url =
    `https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`;

  await axios.post(url, {
    chat_id: CONFIG.telegramChatId,
    text: message,
    disable_web_page_preview: true
  }, {
    timeout: 15000
  });
}


async function sendAlert(coin) {
  // Lấy thông tin Funding từ Binance
  const funding = await getFundingInfo(coin.symbol);

  const time = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh"
  });

  const fundingText = funding.fundingRate === null
    ? "Không có dữ liệu"
    : `${funding.fundingRate >= 0 ? "+" : ""}${funding.fundingRate.toFixed(4)}%`;

  const message = [
    "🚀 BINANCE FUTURES PUMP ALERT",
    "",
    `🪙 Coin: ${coin.symbol}`,
    `📈 Tăng: +${coin.percent.toFixed(2)}%`,
    "⏱ Khung thời gian: 1H",
    `💰 Giá mở nến: ${formatPrice(coin.open)}`,
    `💵 Giá hiện tại: ${formatPrice(coin.price)}`,
    "",
    "💸 FUNDING RATE",
    `📊 Funding: ${fundingText}`,
    `🕒 Funding tiếp theo: ${funding.fundingTime}`,
    "",
    `⏰ Thời gian cảnh báo: ${time}`,
    "",
    `🔗 https://www.coinglass.com/tv/vi/Binance_${coin.symbol}`
  ].join("\n");

  await sendTelegram(message);
}


async function getFundingInfo(symbol) {
  try {
    const data = await request("/fapi/v1/premiumIndex", {
      symbol
    });

    const fundingRate = Number(data.lastFundingRate) * 100;

    const nextFundingTime = Number(data.nextFundingTime);

    const fundingTime = nextFundingTime > 0
      ? new Date(nextFundingTime).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "2-digit"
        })
      : "Chưa có dữ liệu";

    return {
      fundingRate,
      fundingTime
    };

  } catch (error) {
    log(`Lỗi lấy Funding ${symbol}: ${error.message}`);

    return {
      fundingRate: null,
      fundingTime: "Không có dữ liệu"
    };
  }
}

// ========================================
// 7. QUÉT TẤT CẢ COIN
// ========================================

async function scanMarket() {
  // Một request lấy giá tất cả Futures
  const prices = await request("/fapi/v1/ticker/price");

  const hour = currentHour();
  const signals = [];

  for (const item of prices) {
    const symbol = item.symbol;

    if (!symbols.has(symbol)) continue;

    const candle = candles.get(symbol);

    if (!candle || candle.openTime !== hour) continue;
    if (!Number.isFinite(candle.open) || candle.open <= 0) continue;

    const price = Number(item.price);
    if (!Number.isFinite(price) || price <= 0) continue;

    const percent = ((price - candle.open) / candle.open) * 100;

    const alertKey = `${symbol}:${hour}`;

    if (
      percent > CONFIG.threshold &&
      !alerted.has(alertKey)
    ) {
      signals.push({
        symbol,
        open: candle.open,
        price,
        percent,
        alertKey
      });
    }
  }

  // Coin tăng mạnh nhất được gửi trước
  signals.sort((a, b) => b.percent - a.percent);

  for (const coin of signals) {
    // Không gửi tín hiệu của nến đã hết giờ
    if (currentHour() !== hour) break;

    if (alerted.has(coin.alertKey)) continue;

    // Đánh dấu trước khi gửi để hạn chế trùng
    alerted.add(coin.alertKey);
    saveState();

    try {
      await sendAlert(coin);

      log(
        `🚀 ALERT ${coin.symbol}: +${coin.percent.toFixed(2)}%`
      );
    } catch (error) {
      // Cho phép gửi lại nếu có lỗi rõ ràng
      // Lưu ý: lỗi timeout có thể xảy ra sau khi Telegram
      // đã nhận tin, nên retry vẫn có rủi ro gửi trùng.
      alerted.delete(coin.alertKey);
      saveState();

      log(`Telegram lỗi: ${error.message}`);
    }

    await sleep(150);
  }

  log(
    `Quét ${symbols.size} coin | Tín hiệu mới: ${signals.length}`
  );
}

// ========================================
// 8. VÒNG LẶP BOT 24/7
// ========================================

async function main() {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
    throw new Error("Thiếu cấu hình Telegram trong .env");
  }

  if (
    !Number.isFinite(CONFIG.threshold) ||
    CONFIG.threshold < 0 ||
    !Number.isFinite(CONFIG.scanInterval) ||
    CONFIG.scanInterval < 1000 ||
    !Number.isFinite(CONFIG.symbolRefresh) ||
    CONFIG.symbolRefresh < 1000 ||
    !Number.isInteger(CONFIG.concurrency) ||
    CONFIG.concurrency < 1
  ) {
    throw new Error("Cấu hình scanner không hợp lệ");
  }

  log("BINANCE FUTURES SCANNER STARTING");

  await syncServerTime();
  loadState();

  while (true) {
    try {
      if (Date.now() - lastTimeSync > 300000) {
        await syncServerTime();
      }

      if (
        symbols.size === 0 ||
        Date.now() - lastSymbolRefresh >= CONFIG.symbolRefresh
      ) {
        await updateSymbols();
      }

      await syncCandles();
      await scanMarket();

    } catch (error) {
      log(`Lỗi vòng quét: ${error.message}`);
    }

    await sleep(CONFIG.scanInterval);
  }
}

main().catch(error => {
  console.error("FATAL:", error.message);
  process.exit(1);
});
