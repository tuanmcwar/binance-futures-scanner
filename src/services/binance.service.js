
const axios = require("axios");
const config = require("../config/config");
const { calculateRSI } = require("../indicators/rsi");

const api = axios.create({
  baseURL: config.binanceUrl,
  timeout: 15000
});

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function request(endpoint, params = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await api.get(endpoint, { params });
      return response.data;
    } catch (error) {
      const status = error.response?.status;

      // Không retry khi Binance chặn IP
      if (status === 418) throw error;

      const retryable =
        !status || status === 429 || status >= 500;

      if (!retryable || attempt === 3) throw error;

      const retryAfter = Number(
        error.response?.headers?.["retry-after"] || 0
      );

      await sleep(
        retryAfter > 0
          ? retryAfter * 1000
          : 1000 * 2 ** attempt
      );
    }
  }
}

async function getServerTime() {
  const data = await request("/fapi/v1/time");
  return Number(data.serverTime);
}

async function getSymbols() {
  const data = await request("/fapi/v1/exchangeInfo");

  return data.symbols
    .filter(s =>
      s.status === "TRADING" &&
      s.contractType === "PERPETUAL" &&
      s.quoteAsset === "USDT" &&
      s.marginAsset === "USDT"
    )
    .map(s => s.symbol);
}

async function getCandle(symbol) {
  const data = await request("/fapi/v1/klines", {
    symbol,
    interval: "1h",
    limit: 2
  });

  const candle = data[data.length - 1];

  if (!candle) throw new Error("Không có dữ liệu nến");

  return {
    openTime: Number(candle[0]),
    open: Number(candle[1])
  };
}

async function getAllPrices() {
  return request("/fapi/v1/ticker/price");
}

async function getFunding(symbol) {
  const data = await request("/fapi/v1/premiumIndex", {
    symbol
  });

  const rawRate = data.lastFundingRate;
  const rate = rawRate == null || rawRate === ""
    ? null
    : Number(rawRate) * 100;

  return {
    rate: Number.isFinite(rate) ? rate : null,
    nextTime: Number(data.nextFundingTime) || null
  };
}

async function getRSI(symbol, period = 14) {
  // Lấy đủ dữ liệu để Wilder smoothing ổn định hơn
  const limit = Math.min(150, Math.max(100, period * 7));

  const klines = await request("/fapi/v1/klines", {
    symbol,
    interval: "1h",
    limit
  });

  if (!Array.isArray(klines) || klines.length < period + 2) {
    return null;
  }

  // Loại nến đang chạy, chỉ tính nến đã đóng
  const closedKlines = klines.slice(0, -1);

  const closes = closedKlines.map(kline =>
    Number(kline[4])
  );

  return calculateRSI(closes, period);
}

module.exports = {
  getServerTime,
  getSymbols,
  getCandle,
  getAllPrices,
  getFunding,
  getRSI
};
