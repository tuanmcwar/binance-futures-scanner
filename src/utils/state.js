
const fs = require("fs");
const path = require("path");
const config = require("../config/config");

let alerted = new Set();

function loadState(hour) {
  try {
    if (!fs.existsSync(config.stateFile)) return;

    const data = JSON.parse(
      fs.readFileSync(config.stateFile, "utf8")
    );

    alerted = new Set(
      (data.alerted || []).filter(key =>
        key.endsWith(`:${hour}`)
      )
    );
  } catch (error) {
    console.error("Lỗi đọc trạng thái:", error.message);
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(config.stateFile), {
    recursive: true
  });

  const temp = config.stateFile + ".tmp";

  fs.writeFileSync(
    temp,
    JSON.stringify({
      alerted: [...alerted],
      updatedAt: new Date().toISOString()
    }, null, 2)
  );

  fs.renameSync(temp, config.stateFile);
}

function hasAlerted(symbol, hour) {
  return alerted.has(`${symbol}:${hour}`);
}

function markAlerted(symbol, hour) {
  alerted.add(`${symbol}:${hour}`);
  saveState();
}

function unmarkAlerted(symbol, hour) {
  alerted.delete(`${symbol}:${hour}`);
  saveState();
}

function cleanup(hour) {
  const active = [...alerted].filter(key =>
    key.endsWith(`:${hour}`)
  );

  if (active.length !== alerted.size) {
    alerted = new Set(active);
    saveState();
  }
}

module.exports = {
  loadState,
  hasAlerted,
  markAlerted,
  unmarkAlerted,
  cleanup
};
