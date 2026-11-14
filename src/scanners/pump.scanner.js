
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

        if (candle?.openTime === currentHour()) {
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

  signals.sort((a, b) => b.percent - a.percent);

  for (const coin of signals) {
    if (currentHour() !== hour) break;
    if (state.hasAlerted(coin.symbol, hour)) continue;

    // Lấy snapshot mới ngay trước khi gửi Telegram
    try {
      const snapshot = await binance.getMarketSnapshot(
        coin.symbol,
        config.scanner.rsiPeriod
      );

      coin.rsi = snapshot.rsi;
      coin.funding = snapshot.funding;
      coin.basis = snapshot.basis;
      coin.orderBook = snapshot.orderBook;
      coin.snapshotTime = snapshot.receivedAt;

      // Cập nhật lại mức tăng theo giá Futures mới nhất
      if (snapshot.basis) {
        coin.price = snapshot.basis.futuresPrice;

        coin.percent =
          (coin.price / coin.open - 1) * 100;
      }
    } catch (error) {
      log(
        `Snapshot lỗi ${coin.symbol}: ${error.message}`
      );

      coin.rsi = null;
      coin.funding = null;
      coin.basis = null;
      coin.orderBook = null;
      coin.snapshotTime = null;
    }

    // Không gửi nếu nến đã chuyển sang giờ mới
    if (currentHour() !== hour) break;

    // Giá mới nhất không còn vượt ngưỡng thì bỏ qua
    if (coin.percent <= config.scanner.threshold) {
      log(
        `Bỏ qua ${coin.symbol}: giá giảm còn ` +
        `${coin.percent.toFixed(2)}%`
      );
      continue;
    }

    state.markAlerted(coin.symbol, hour);

    try {
      await telegram.sendAlert(coin);

      log(
        `🚀 ${coin.symbol} +${coin.percent.toFixed(2)}%` +
        ` | RSI: ${coin.rsi?.toFixed(2) ?? "N/A"}` +
        ` | Basis: ${coin.basis?.basisRate?.toFixed(4) ?? "N/A"}%` +
        ` | Imbalance: ${coin.orderBook?.imbalance?.toFixed(2) ?? "N/A"}%`
      );
    } catch (error) {
      state.unmarkAlerted(coin.symbol, hour);

      log(`Telegram lỗi ${coin.symbol}: ${error.message}`);
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

  log(
    `Bot chỉ quét vào phút ${config.scanner.scanMinute}`
  );

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
      const minute = now.getUTCMinutes();
      const hour = currentHour();

      if (
        minute === config.scanner.scanMinute &&
        lastScannedHour !== hour
      ) {
        log(
          `⏰ Đến phút ${config.scanner.scanMinute}, ` +
          `bắt đầu quét Futures`
        );

        await syncCandles();
        await scanMarket();

        lastScannedHour = hour;

        log(
          `✅ Hoàn thành lượt quét phút ` +
          config.scanner.scanMinute
        );
      }
    } catch (error) {
      log(`Scanner lỗi: ${error.message}`);
    }

    await sleep(1000);
  }
}

module.exports = { startScanner };
