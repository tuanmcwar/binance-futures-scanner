
const config = require("./config/config");
const { log } = require("./utils/logger");
const { startScanner } = require("./scanners/pump.scanner");

async function main() {
  if (!config.telegram.token || !config.telegram.chatId) {
    throw new Error("Thiếu Telegram Token hoặc Chat ID");
  }

  const s = config.scanner;

  if (
    !Number.isFinite(s.threshold) ||
    s.threshold < 0 ||
    !Number.isFinite(s.interval) ||
    s.interval < 1000 ||
    !Number.isFinite(s.symbolRefresh) ||
    s.symbolRefresh < 1000 ||
    !Number.isInteger(s.concurrency) ||
    s.concurrency < 1 ||
    !Number.isInteger(s.rsiPeriod) ||
    s.rsiPeriod < 2 ||
    s.rsiPeriod > 20
  ) {
    throw new Error("Cấu hình scanner không hợp lệ");
  }

  log("🚀 BINANCE FUTURES SCANNER STARTED");
  log(`Khung thời gian: 1H`);
  log(`Ngưỡng tăng: > ${s.threshold}%`);
  log(`RSI Period: ${s.rsiPeriod}`);
  log(`Quét mỗi ${s.interval / 1000} giây`);

  await startScanner();
}

main().catch(error => {
  console.error("FATAL:", error.message);
  process.exit(1);
});
