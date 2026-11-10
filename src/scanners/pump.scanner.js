
const binance = require("../services/binance.service");
const telegram = require("../services/telegram.service");
const state = require("../utils/state");
const { log } = require("../utils/logger");
const config = require("../config/config");

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

let symbols = new Set();
let candles = new Map();
let lastRefresh = 0;
let serverOffset = 0;

function currentHour() {
  return Math.floor(
    (Date.now() + serverOffset) / 3600000
  ) * 3600000;
}

async function syncTime() {
  const before = Date.now();
  const serverTime = await binance.getServerTime();
  const after = Date.now();

  serverOffset = serverTime - (before + after) / 2;
}

async function refreshSymbols() {
  const list = await binance.getSymbols();

  symbols = new Set(list);
  lastRefresh = Date.now();

  for (const symbol of candles.keys()) {
    if (!symbols.has(symbol)) {
      candles.delete(symbol);
    }
  }

  log(`Đang theo dõi ${symbols.size} coin`);
}

async function syncCandles() {
  const hour = currentHour();

  const missing = [...symbols].filter(symbol =>
    candles.get(symbol)?.openTime !== hour
  );

  if (missing.length === 0) return;

  log(`Đồng bộ ${missing.length} nến 1H`);

  let index = 0;

  async function worker() {
    while (index < missing.length) {
      const symbol = missing[index++];

      try {
        const candle = await binance.getCandle(symbol);

        if (candle.openTime === currentHour()) {
          candles.set(symbol, candle);
        }
      } catch (error) {
        log(`Lỗi nến ${symbol}: ${error.message}`);
      }

      await sleep(150);
    }
  }

  await Promise.all(
    Array.from({
      length: Math.min(
        config.scanner.concurrency,
        missing.length
      )
    }, () => worker())
  );
}

async function scanMarket() {
  const hour = currentHour();
  const prices = await binance.getAllPrices();
  const signals = [];

  for (const item of prices) {
    const symbol = item.symbol;

    if (!symbols.has(symbol)) continue;

    const candle = candles.get(symbol);

    if (!candle || candle.openTime !== hour) continue;
    if (!Number.isFinite(candle.open) || candle.open <= 0) continue;

    const price = Number(item.price);

    if (!Number.isFinite(price) || price <= 0) continue;

    const percent = (price / candle.open - 1) * 100;

    if (
      percent > config.scanner.threshold &&
      !state.hasAlerted(symbol, hour)
    ) {
      signals.push({
        symbol,
        open: candle.open,
        price,
        percent
      });
    }
  }

  // Ưu tiên coin tăng mạnh nhất
  signals.sort((a, b) => b.percent - a.percent);

  for (const coin of signals) {
    if (currentHour() !== hour) break;
    if (state.hasAlerted(coin.symbol, hour)) continue;

    // Lấy RSI và Funding đồng thời
    const [rsiResult, fundingResult] =
      await Promise.allSettled([
        binance.getRSI(
          coin.symbol,
          config.scanner.rsiPeriod
        ),
        binance.getFunding(coin.symbol)
      ]);

    if (rsiResult.status === "fulfilled") {
      coin.rsi = rsiResult.value;
    } else {
      coin.rsi = null;
      log(`RSI lỗi ${coin.symbol}: ${rsiResult.reason.message}`);
    }

    if (fundingResult.status === "fulfilled") {
      coin.funding = fundingResult.value;
    } else {
      coin.funding = null;
      log(
        `Funding lỗi ${coin.symbol}: ${fundingResult.reason.message}`
      );
    }

    // Không gửi nếu nến đã chuyển sang giờ mới
    if (currentHour() !== hour) break;

    state.markAlerted(coin.symbol, hour);

    try {
      await telegram.sendAlert(coin);

      log(
        `🚀 ${coin.symbol} +${coin.percent.toFixed(2)}%` +
        ` | RSI: ${coin.rsi?.toFixed(2) ?? "N/A"}`
      );
    } catch (error) {
      // Timeout có thể xảy ra sau khi Telegram đã nhận tin.
      // Gửi lại có rủi ro tạo cảnh báo trùng.
      state.unmarkAlerted(coin.symbol, hour);
      log(`Telegram lỗi: ${error.message}`);
    }

    await sleep(150);
  }

  log(
    `Quét ${symbols.size} coin | Tín hiệu mới: ${signals.length}`
  );
}


async function startScanner() {
  await syncTime();
  state.loadState(currentHour());

  let lastTimeSync = Date.now();
  let lastScannedHour = null;

  log(`Bot chỉ quét vào phút ${config.scanner.scanMinute}`);

  while (true) {
    try {
      // Đồng bộ thời gian Binance mỗi 5 phút
      if (Date.now() - lastTimeSync >= 300000) {
        await syncTime();
        lastTimeSync = Date.now();
      }

      // Cập nhật danh sách coin mỗi 30 phút
      if (
        symbols.size === 0 ||
        Date.now() - lastRefresh >=
          config.scanner.symbolRefresh
      ) {
        await refreshSymbols();
      }

      const now = new Date(Date.now() + serverOffset);

      // Dùng UTC vì phút trong giờ giống nhau
      // giữa UTC và giờ Việt Nam (+7)
      const minute = now.getUTCMinutes();
      const hour = currentHour();

      // Chỉ quét 1 lần mỗi giờ tại phút 58
      if (
        minute === config.scanner.scanMinute &&
        lastScannedHour !== hour
      ) {
        log("⏰ Đến phút 58, bắt đầu quét Futures");

        await syncCandles();
        await scanMarket();

        lastScannedHour = hour;

        log("✅ Hoàn thành lượt quét phút 58");
      }
    } catch (error) {
      log(`Scanner lỗi: ${error.message}`);
    }

    // Kiểm tra thời gian mỗi giây
    await sleep(1000);
  }
}


module.exports = { startScanner };
