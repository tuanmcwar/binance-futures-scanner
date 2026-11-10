
function log(message) {
  const time = new Date().toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh"
  });

  console.log(`[${time}] ${message}`);
}

module.exports = { log };
