import type { MarketCandle } from "../market/marketDataClient.js";
import type { Direction } from "./marketIntelligence.js";

/**
 * Fast LMP confluence (Liquidity + Momentum + Pressure).
 * Pure candle math — no extra network calls.
 * When all three align → high-confidence signal bias.
 */
export interface LmpConfluence {
  liquidity: Direction;
  momentum: Direction;
  pressure: Direction;
  aligned: boolean;
  direction: Direction;
  score: number; // 0–10
  confidenceBoost: number;
  labels: string[];
}

function parts(c: MarketCandle) {
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  const close = Number(c.close);
  const range = Math.max(high - low, 1e-8);
  const body = Math.abs(close - open);
  const vol = Number(c.tick_volume ?? 0);
  return {
    open,
    high,
    low,
    close,
    range,
    body,
    upper: high - Math.max(open, close),
    lower: Math.min(open, close) - low,
    bullish: close > open,
    bearish: close < open,
    vol: Number.isFinite(vol) && vol > 0 ? vol : 0,
    activity: Number.isFinite(vol) && vol > 0 ? vol : body / range || 1,
    buyPressure: (close - low) / range,
    sellPressure: (high - close) / range,
  };
}

function voteDir(up: number, down: number, minDiff = 0.5): Direction {
  if (up - down >= minDiff) return "UP";
  if (down - up >= minDiff) return "DOWN";
  return "SIDEWAYS";
}

/** Liquidity: masked sweep / grab — pierce + reject wick only (no fake breakouts). */
function scoreLiquidity(candles: MarketCandle[]): { dir: Direction; strength: number; label: string } {
  if (candles.length < 6) {
    return { dir: "SIDEWAYS", strength: 0, label: "Liquidity thin" };
  }
  const parsed = candles.map(parts);
  const last = parsed[parsed.length - 1];
  const prior = parsed.slice(-10, -1);
  const recentHigh = Math.max(...prior.map((c) => c.high));
  const recentLow = Math.min(...prior.map((c) => c.low));
  const avgRange = prior.reduce((a, c) => a + c.range, 0) / Math.max(1, prior.length) || last.range;
  const pierceMin = Math.max(avgRange * 0.08, last.range * 0.12);

  let up = 0;
  let down = 0;
  let label = "Liquidity neutral";

  const upperR = last.upper / last.range;
  const lowerR = last.lower / last.range;
  const bodyR = last.body / last.range;

  // Equal-high / equal-low pool mask
  const nearHighHits = prior.filter(
    (c) => Math.abs(c.high - recentHigh) / Math.max(Math.abs(recentHigh), 1e-8) < 0.0003
  ).length;
  const nearLowHits = prior.filter(
    (c) => Math.abs(c.low - recentLow) / Math.max(Math.abs(recentLow), 1e-8) < 0.0003
  ).length;

  // SSL sweep → bullish (must reject back above)
  if (
    recentLow - last.low >= pierceMin * 0.35 &&
    last.close > recentLow &&
    lowerR >= 0.28 &&
    bodyR <= 0.55
  ) {
    up += nearLowHits >= 2 ? 4 : 3;
    label = nearLowHits >= 2 ? "SSL pool grab masked" : "SSL liquidity grab";
  }
  // BSL sweep → bearish
  if (
    last.high - recentHigh >= pierceMin * 0.35 &&
    last.close < recentHigh &&
    upperR >= 0.28 &&
    bodyR <= 0.55
  ) {
    down += nearHighHits >= 2 ? 4 : 3;
    label = nearHighHits >= 2 ? "BSL pool grab masked" : "BSL liquidity grab";
  }

  // Pool sweep without deep pierce but clear reject at equal highs/lows
  if (nearHighHits >= 2 && last.high >= recentHigh && last.bearish && upperR >= 0.32) {
    down += 2;
    label = "Equal-high liquidity masked";
  }
  if (nearLowHits >= 2 && last.low <= recentLow && last.bullish && lowerR >= 0.32) {
    up += 2;
    label = "Equal-low liquidity masked";
  }

  // Fake breakout mask: close beyond level with tiny wick = NOT liquidity (continuation)
  if (last.close > recentHigh && upperR < 0.2 && bodyR >= 0.5) {
    down = 0; // clear bullish break — don't score bearish liq
    if (up === 0) label = "Breakout masked · no BSL";
  }
  if (last.close < recentLow && lowerR < 0.2 && bodyR >= 0.5) {
    up = 0;
    if (down === 0) label = "Breakdown masked · no SSL";
  }

  // Activity spike only confirms an already-detected grab
  const avgAct =
    prior.reduce((a, c) => a + c.activity, 0) / Math.max(1, prior.length) || 1;
  if (last.activity >= avgAct * 1.35 && (up >= 3 || down >= 3)) {
    if (up >= down) up += 1;
    else down += 1;
  }

  const dir = voteDir(up, down, 1.5);
  return { dir, strength: Math.max(up, down), label };
}

/** Momentum: streak + body expansion + short EMA slope. */
function scoreMomentum(candles: MarketCandle[]): { dir: Direction; strength: number; label: string } {
  if (candles.length < 5) {
    return { dir: "SIDEWAYS", strength: 0, label: "Momentum thin" };
  }
  const parsed = candles.map(parts);
  const closes = parsed.map((c) => c.close);
  const lastN = parsed.slice(-5);

  let up = 0;
  let down = 0;

  let green = 0;
  let red = 0;
  for (const c of lastN) {
    if (c.bullish) green++;
    if (c.bearish) red++;
  }
  if (green >= 3) up += green - 1;
  if (red >= 3) down += red - 1;

  // Expanding bodies in same direction
  const bodies = lastN.map((c) => c.body);
  if (bodies.length >= 3) {
    const growing =
      bodies[bodies.length - 1] > bodies[bodies.length - 2] &&
      bodies[bodies.length - 2] >= bodies[bodies.length - 3] * 0.85;
    if (growing && lastN[lastN.length - 1].bullish) up += 2;
    if (growing && lastN[lastN.length - 1].bearish) down += 2;
  }

  // Fast EMA slope (period 5 vs 9 on closes)
  if (closes.length >= 9) {
    const ema = (period: number) => {
      const k = 2 / (period + 1);
      let v = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
      for (let i = period; i < closes.length; i++) v = closes[i] * k + v * (1 - k);
      return v;
    };
    const e5 = ema(5);
    const e9 = ema(9);
    if (e5 > e9) up += 2;
    if (e5 < e9) down += 2;
  }

  // Last close vs 3-bar ago
  if (closes.length >= 4) {
    const delta = closes[closes.length - 1] - closes[closes.length - 4];
    if (delta > 0) up += 1;
    if (delta < 0) down += 1;
  }

  const dir = voteDir(up, down, 1);
  const label =
    dir === "UP"
      ? "Bullish momentum"
      : dir === "DOWN"
        ? "Bearish momentum"
        : "Momentum flat";
  return { dir, strength: Math.max(up, down), label };
}

/** Pressure: buy/sell pressure from candle positioning + activity. */
function scorePressure(candles: MarketCandle[]): { dir: Direction; strength: number; label: string } {
  if (candles.length < 3) {
    return { dir: "SIDEWAYS", strength: 0, label: "Pressure thin" };
  }
  const parsed = candles.map(parts).slice(-6);

  let buy = 0;
  let sell = 0;
  for (const c of parsed) {
    const w = Math.max(0.5, c.activity);
    buy += c.buyPressure * w;
    sell += c.sellPressure * w;
    // Close near high = buyers in control
    if (c.buyPressure >= 0.65) buy += 0.8 * w;
    if (c.sellPressure >= 0.65) sell += 0.8 * w;
  }

  const last = parsed[parsed.length - 1];
  // Immediate pressure from last candle
  if (last.buyPressure >= 0.7 && last.body / last.range >= 0.45) buy += 2;
  if (last.sellPressure >= 0.7 && last.body / last.range >= 0.45) sell += 2;

  const dir = voteDir(buy, sell, buy + sell > 0 ? (buy + sell) * 0.08 : 0.5);
  const label =
    dir === "UP"
      ? "Buy pressure"
      : dir === "DOWN"
        ? "Sell pressure"
        : "Pressure mixed";
  return { dir, strength: Math.max(buy, sell) / Math.max(1, parsed.length), label };
}

/**
 * Core rule used by strong bots:
 * Liquidity + Momentum + Pressure same direction → take signal.
 */
export function analyzeLmpConfluence(candles: MarketCandle[]): LmpConfluence {
  const labels: string[] = [];
  if (!candles.length) {
    return {
      liquidity: "SIDEWAYS",
      momentum: "SIDEWAYS",
      pressure: "SIDEWAYS",
      aligned: false,
      direction: "SIDEWAYS",
      score: 0,
      confidenceBoost: 0,
      labels: ["LMP waiting candles"],
    };
  }

  const liq = scoreLiquidity(candles);
  const mom = scoreMomentum(candles);
  const pre = scorePressure(candles);

  labels.push(liq.label, mom.label, pre.label);

  const dirs = [liq.dir, mom.dir, pre.dir].filter((d) => d !== "SIDEWAYS");
  const upVotes = dirs.filter((d) => d === "UP").length;
  const downVotes = dirs.filter((d) => d === "DOWN").length;

  const aligned =
    (liq.dir === "UP" && mom.dir === "UP" && pre.dir === "UP") ||
    (liq.dir === "DOWN" && mom.dir === "DOWN" && pre.dir === "DOWN");

  let direction: Direction = "SIDEWAYS";
  let score = 0;
  let confidenceBoost = 0;

  if (aligned) {
    direction = liq.dir;
    score = 10;
    confidenceBoost = 12;
    labels.unshift(`LMP aligned ${direction}`);
  } else if (upVotes >= 2 && downVotes === 0) {
    direction = "UP";
    score = 7;
    confidenceBoost = 7;
    labels.unshift("LMP majority UP");
  } else if (downVotes >= 2 && upVotes === 0) {
    direction = "DOWN";
    score = 7;
    confidenceBoost = 7;
    labels.unshift("LMP majority DOWN");
  } else if (upVotes > downVotes) {
    direction = "UP";
    score = 4;
    confidenceBoost = 3;
  } else if (downVotes > upVotes) {
    direction = "DOWN";
    score = 4;
    confidenceBoost = 3;
  }

  // Soft conflict: don't hard-block, just lower boost
  if (upVotes > 0 && downVotes > 0 && !aligned) {
    confidenceBoost = Math.max(0, confidenceBoost - 2);
    labels.push("LMP partial conflict");
  }

  return {
    liquidity: liq.dir,
    momentum: mom.dir,
    pressure: pre.dir,
    aligned,
    direction,
    score,
    confidenceBoost,
    labels: labels.slice(0, 4),
  };
}
