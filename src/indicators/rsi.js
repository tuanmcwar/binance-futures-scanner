
function calculateRSI(closes, period = 14) {
  if (
    !Number.isInteger(period) ||
    period < 1 ||
    !Array.isArray(closes) ||
    closes.length < period + 1
  ) {
    return null;
  }

  if (closes.some(v => !Number.isFinite(v) || v <= 0)) {
    return null;
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];

    avgGain += Math.max(change, 0);
    avgLoss += Math.max(-change, 0);
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

module.exports = { calculateRSI };
