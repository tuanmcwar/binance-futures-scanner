
const axios = require("axios");
const { calculateRSI } = require("../indicators/rsi");

const client = axios.create({
  baseURL: "https://fapi.binance.com",
  timeout: 15000
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(endpoint, params = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await client.get(endpoint, { params });
      return response.data;
    } catch (error) {
      const status = error.response?.status;

      const retryable =
        !status || status === 429 || status >= 500;

      if (!retryable || attempt === 4) {
        throw error;
      }

      await sleep(1000 * 2 ** (attempt - 1));
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
    .filter(item =>
      item.status === "TRADING" &&
      item.contractType === "PERPETUAL" &&
      item.quoteAsset === "USDT" &&
      item.marginAsset === "USDT"
    )
    .map(item => item.symbol);
}

async function getCandle(symbol) {
  const klines = await request("/fapi/v1/klines", {
    symbol,
    interval: "1h",
    limit: 2
  });

  const candle = klines[klines.length - 1];

  if (!candle) return null;

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

  return {
    rate: Number(data.lastFundingRate) * 100,
    nextTime: Number(data.nextFundingTime) || null
  };
}

async function getRSI(symbol, period = 14) {
  const klines = await request("/fapi/v1/klines", {
    symbol,
    interval: "1h",
    limit: 500
  });

  if (!Array.isArray(klines) || klines.length < period + 1) {
    return null;
  }

  const closes = klines.map(k => Number(k[4]));
  return calculateRSI(closes, period);
}

// Lấy snapshot dữ liệu mới nhất cho coin được cảnh báo
async function getMarketSnapshot(symbol, period = 14) {
  const requestedAt = Date.now();

  const results = await Promise.allSettled([
    request("/fapi/v1/premiumIndex", { symbol }),
    request("/fapi/v1/ticker/price", { symbol }),
    request("/fapi/v1/depth", { symbol, limit: 1000 }),
    getRSI(symbol, period)
  ]);

  const [premiumResult, tickerResult, depthResult, rsiResult] =
    results;

  const premium = premiumResult.status === "fulfilled"
    ? premiumResult.value
    : null;

  const ticker = tickerResult.status === "fulfilled"
    ? tickerResult.value
    : null;

  const depth = depthResult.status === "fulfilled"
    ? depthResult.value
    : null;

  const rsi = rsiResult.status === "fulfilled"
    ? rsiResult.value
    : null;

  const futuresPrice = ticker
    ? Number(ticker.price)
    : NaN;

  const indexPrice = premium
    ? Number(premium.indexPrice)
    : NaN;

  let basis = null;

  if (
    Number.isFinite(futuresPrice) &&
    Number.isFinite(indexPrice) &&
    futuresPrice > 0 &&
    indexPrice > 0
  ) {
    const difference = futuresPrice - indexPrice;

    basis = {
      futuresPrice,
      indexPrice,
      basis: difference,
      basisRate: difference / indexPrice * 100
    };
  }

  let funding = null;

  if (premium) {
    const rate = Number(premium.lastFundingRate);

    if (Number.isFinite(rate)) {
      funding = {
        rate: rate * 100,
        nextTime: Number(premium.nextFundingTime) || null
      };
    }
  }

  let orderBook = null;

  if (
    depth &&
    Array.isArray(depth.bids) &&
    Array.isArray(depth.asks) &&
    Number.isFinite(futuresPrice) &&
    futuresPrice > 0
  ) {
    const lower = futuresPrice * 0.9;
    const upper = futuresPrice * 1.1;

    let buyDepth = 0;
    let sellDepth = 0;

    for (const [p, q] of depth.bids) {
      const price = Number(p);
      const quantity = Number(q);

      if (
        Number.isFinite(price) &&
        Number.isFinite(quantity) &&
        price >= lower &&
        price <= futuresPrice
      ) {
        buyDepth += price * quantity;
      }
    }

    for (const [p, q] of depth.asks) {
      const price = Number(p);
      const quantity = Number(q);

      if (
        Number.isFinite(price) &&
        Number.isFinite(quantity) &&
        price >= futuresPrice &&
        price <= upper
      ) {
        sellDepth += price * quantity;
      }
    }

    const total = buyDepth + sellDepth;

    const lowestBid = depth.bids.length
      ? Number(depth.bids[depth.bids.length - 1][0])
      : NaN;

    const highestAsk = depth.asks.length
      ? Number(depth.asks[depth.asks.length - 1][0])
      : NaN;

    orderBook = {
      buyDepth,
      sellDepth,
      imbalance: total > 0
        ? (buyDepth - sellDepth) / total * 100
        : null,
      coverageComplete:
        Number.isFinite(lowestBid) &&
        Number.isFinite(highestAsk) &&
        lowestBid <= lower &&
        highestAsk >= upper
    };
  }

  return {
    basis,
    funding,
    orderBook,
    rsi,
    requestedAt,
    receivedAt: Date.now()
  };
}

module.exports = {
  getServerTime,
  getSymbols,
  getCandle,
  getAllPrices,
  getFunding,
  getRSI,
  getMarketSnapshot
};
