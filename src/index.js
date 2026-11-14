
const config = require("./config/config");
const { log } = require("./utils/logger");
const { startScanner } = require("./scanners/pump.scanner");
const { startTelegramBot } = require("./services/telegram.bot");
const {
  loadSubscribers,
  getSubscriberCount
} = require("./utils/subscribers");

async function main() {
  // Chỉ yêu cầu Telegram Bot Token
  // Không cần TELEGRAM_CHAT_ID cố định
  if (!config.telegram.token) {
    throw new Error("Thiếu TELEGRAM_BOT_TOKEN");
  }

  const s = config.scanner;

  // Kiểm tra cấu hình scanner
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
    s.rsiPeriod > 20 ||
    !Number.isInteger(s.scanMinute) ||
    s.scanMinute < 0 ||
    s.scanMinute > 59
  ) {
    throw new Error("Cấu hình scanner không hợp lệ");
  }

  // Tải danh sách người đăng ký
  loadSubscribers();

  log("🚀 BINANCE FUTURES SCANNER STARTED");
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log("Khung thời gian: 1H");
  log(`Ngưỡng tăng: > ${s.threshold}%`);
  log(`RSI Period: ${s.rsiPeriod}`);
  log(`Phút quét: ${s.scanMinute}`);
  log(`Kiểm tra thời gian mỗi ${s.interval / 1000} giây`);
  log(`Người đăng ký: ${getSubscriberCount()}`);
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Chạy Telegram Bot và Binance Scanner đồng thời
  await Promise.all([
    startTelegramBot(),
    startScanner()
  ]);
}

main().catch(error => {
  console.error("FATAL:", error.message);
  process.exit(1);
});
