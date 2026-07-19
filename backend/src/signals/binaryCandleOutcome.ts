export type BinaryDirection = "CALL" | "PUT";

/** Quotex M1: CALL wins on green candle, PUT on red; flat = profit. */
export function evaluateBinaryCandleOutcome(
  direction: BinaryDirection,
  candle: { open: number; close: number }
): "profit" | "loss" {
  const { open, close } = candle;
  const flatMove = Math.max(Math.abs(open) * 0.000001, 0.0000001);

  if (Math.abs(close - open) <= flatMove) return "profit";

  if (direction === "CALL") {
    return close > open ? "profit" : "loss";
  }
  return close < open ? "profit" : "loss";
}
