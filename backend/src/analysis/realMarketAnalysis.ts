import type { MarketCandle } from "../market/marketDataClient.js";
import type { Direction } from "./marketIntelligence.js";

/**
 * Real Market Analyzer — fast local confluence engine.
 * MACD + MA + Volume + Liquidity + Candlestick + Wick + Order Flow + Order Block + FVG + Structure.
 * Pure math on candles (no extra AI tokens).
 */

export interface RealMarketLayer {
  direction: Direction;
  strength: number; // 0–10
  label: string;
}

export interface RealMarketSignal {
  direction: Direction;
  confidence: number;
  alignedCount: number;
  labels: string[];
  layers: {
    macd: RealMarketLayer;
    ma: RealMarketLayer;
    volume: RealMarketLayer;
    liquidity: RealMarketLayer;
    pattern: RealMarketLayer;
    wick: RealMarketLayer;
    orderFlow: RealMarketLayer;
    orderBlock: RealMarketLayer;
    fvg: RealMarketLayer;
    structure: RealMarketLayer;
  };
  summaryMarkdown: string;
}

interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  range: number;
  body: number;
  upper: number;
  lower: number;
  bullish: boolean;
  bearish: boolean;
  vol: number;
  activity: number;
  buyPressure: number;
  sellPressure: number;
}

function parseBars(candles: MarketCandle[]): Bar[] {
  return candles
    .map((c) => {
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);
      if (![open, high, low, close].every(Number.isFinite)) return null;
      const range = Math.max(high - low, 1e-8);
      const body = Math.abs(close - open);
      const vol = Number(c.tick_volume ?? 0);
      const activity =
        Number.isFinite(vol) && vol > 0 ? vol : Math.max(body / range, 0.15) * 1e3;
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
        activity,
        buyPressure: (close - low) / range,
        sellPressure: (high - close) / range,
      };
    })
    .filter((b): b is Bar => b !== null);
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function vote(up: number, down: number, min = 0.6): Direction {
  if (up - down >= min) return "UP";
  if (down - up >= min) return "DOWN";
  return "SIDEWAYS";
}

function layerMacd(closes: number[]): RealMarketLayer {
  if (closes.length < 35) {
    return { direction: "SIDEWAYS", strength: 0, label: "MACD warming" };
  }
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  // Align lengths: ema12 starts earlier — take last N of both
  const n = Math.min(ema12.length, ema26.length);
  const macdLine: number[] = [];
  for (let i = 0; i < n; i++) {
    macdLine.push(ema12[ema12.length - n + i] - ema26[ema26.length - n + i]);
  }
  const signal = emaSeries(macdLine, 9);
  if (signal.length < 2 || macdLine.length < 2) {
    return { direction: "SIDEWAYS", strength: 0, label: "MACD thin" };
  }
  const m0 = macdLine[macdLine.length - 1];
  const m1 = macdLine[macdLine.length - 2];
  const s0 = signal[signal.length - 1];
  const s1 = signal[signal.length - 2];
  const hist = m0 - s0;
  const histPrev = m1 - s1;

  let up = 0;
  let down = 0;
  if (m0 > s0) up += 2;
  if (m0 < s0) down += 2;
  if (hist > 0 && hist > histPrev) up += 2; // rising histogram
  if (hist < 0 && hist < histPrev) down += 2;
  if (m1 <= s1 && m0 > s0) up += 3; // bullish cross
  if (m1 >= s1 && m0 < s0) down += 3; // bearish cross

  const dir = vote(up, down, 1);
  const label =
    dir === "UP"
      ? hist > histPrev
        ? "MACD bullish + rising hist"
        : "MACD bullish"
      : dir === "DOWN"
        ? hist < histPrev
          ? "MACD bearish + falling hist"
          : "MACD bearish"
        : "MACD flat";
  return { direction: dir, strength: Math.min(10, Math.max(up, down)), label };
}

function layerMa(closes: number[]): RealMarketLayer {
  if (closes.length < 21) {
    return { direction: "SIDEWAYS", strength: 0, label: "MA warming" };
  }
  const e9 = emaSeries(closes, 9);
  const e21 = emaSeries(closes, 21);
  const e50 = closes.length >= 50 ? emaSeries(closes, 50) : [];
  if (!e9.length || !e21.length) {
    return { direction: "SIDEWAYS", strength: 0, label: "MA thin" };
  }
  const last = closes[closes.length - 1];
  const a = e9[e9.length - 1];
  const b = e21[e21.length - 1];
  const c = e50.length ? e50[e50.length - 1] : null;

  let up = 0;
  let down = 0;
  if (a > b) up += 2;
  if (a < b) down += 2;
  if (last > a && last > b) up += 2;
  if (last < a && last < b) down += 2;
  if (c != null) {
    if (a > b && b > c) up += 3;
    if (a < b && b < c) down += 3;
    if (last > c) up += 1;
    if (last < c) down += 1;
  }

  const dir = vote(up, down, 1);
  return {
    direction: dir,
    strength: Math.min(10, Math.max(up, down)),
    label:
      dir === "UP"
        ? c != null && a > b && b > c
          ? "EMA 9>21>50 stack"
          : "Price above fast MAs"
        : dir === "DOWN"
          ? c != null && a < b && b < c
            ? "EMA 9<21<50 stack"
            : "Price below fast MAs"
          : "MA mixed",
  };
}

function layerVolume(bars: Bar[]): RealMarketLayer {
  if (bars.length < 6) {
    return { direction: "SIDEWAYS", strength: 0, label: "Volume thin" };
  }
  const last = bars[bars.length - 1];
  const prior = bars.slice(-8, -1);
  const avg =
    prior.reduce((s, b) => s + b.activity, 0) / Math.max(1, prior.length) || 1;
  const ratio = last.activity / avg;
  let up = 0;
  let down = 0;
  if (ratio >= 1.2) {
    if (last.bullish) up += 3;
    if (last.bearish) down += 3;
  } else if (ratio >= 0.9) {
    if (last.bullish) up += 1;
    if (last.bearish) down += 1;
  }
  // Volume climax rejection: high activity + long opposite wick
  if (ratio >= 1.35 && last.upper / last.range >= 0.4) down += 2;
  if (ratio >= 1.35 && last.lower / last.range >= 0.4) up += 2;

  const dir = vote(up, down, 1);
  return {
    direction: dir,
    strength: Math.min(10, Math.max(up, down) + (ratio >= 1.25 ? 1 : 0)),
    label:
      ratio >= 1.25
        ? `Volume surge ×${ratio.toFixed(2)}`
        : ratio >= 0.85
          ? "Volume normal"
          : "Volume soft",
  };
}

function layerLiquidity(bars: Bar[]): RealMarketLayer {
  if (bars.length < 8) {
    return { direction: "SIDEWAYS", strength: 0, label: "Liquidity thin" };
  }
  const last = bars[bars.length - 1];
  const prior = bars.slice(-12, -1);
  const hi = Math.max(...prior.map((b) => b.high));
  const lo = Math.min(...prior.map((b) => b.low));
  const avgR = prior.reduce((s, b) => s + b.range, 0) / prior.length || last.range;

  let up = 0;
  let down = 0;
  let label = "Liquidity neutral";

  // SSL / BSL with rejection close
  if (
    lo - last.low >= avgR * 0.05 &&
    last.close > lo &&
    last.lower / last.range >= 0.28
  ) {
    up += 4;
    label = "SSL liquidity grab";
  }
  if (
    last.high - hi >= avgR * 0.05 &&
    last.close < hi &&
    last.upper / last.range >= 0.28
  ) {
    down += 4;
    label = "BSL liquidity grab";
  }

  // Equal highs/lows pool
  const eqHi = prior.filter((b) => Math.abs(b.high - hi) / Math.max(hi, 1e-8) < 0.0003).length;
  const eqLo = prior.filter((b) => Math.abs(b.low - lo) / Math.max(lo, 1e-8) < 0.0003).length;
  if (eqHi >= 2 && last.high >= hi && last.bearish && last.upper / last.range >= 0.3) {
    down += 2;
    label = "Equal-high pool swept";
  }
  if (eqLo >= 2 && last.low <= lo && last.bullish && last.lower / last.range >= 0.3) {
    up += 2;
    label = "Equal-low pool swept";
  }

  const dir = vote(up, down, 1.5);
  return { direction: dir, strength: Math.min(10, Math.max(up, down)), label };
}

function layerPattern(bars: Bar[]): RealMarketLayer {
  if (bars.length < 2) {
    return { direction: "SIDEWAYS", strength: 0, label: "Pattern thin" };
  }
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const bodyR = last.body / last.range;
  const upR = last.upper / last.range;
  const loR = last.lower / last.range;

  // Engulfing
  if (
    last.bullish &&
    prev.bearish &&
    last.close >= prev.open &&
    last.open <= prev.close &&
    bodyR >= 0.45
  ) {
    return { direction: "UP", strength: 7, label: "Bullish engulfing" };
  }
  if (
    last.bearish &&
    prev.bullish &&
    last.close <= prev.open &&
    last.open >= prev.close &&
    bodyR >= 0.45
  ) {
    return { direction: "DOWN", strength: 7, label: "Bearish engulfing" };
  }

  // Pin / hammer / star
  if (loR >= 0.45 && bodyR <= 0.35 && upR < 0.25) {
    return { direction: "UP", strength: 7, label: "Hammer / pin buy" };
  }
  if (upR >= 0.45 && bodyR <= 0.35 && loR < 0.25) {
    return { direction: "DOWN", strength: 7, label: "Shooting star / pin sell" };
  }

  // Marubozu
  if (bodyR >= 0.7 && upR <= 0.15 && loR <= 0.15) {
    return {
      direction: last.bullish ? "UP" : "DOWN",
      strength: 6,
      label: last.bullish ? "Bull marubozu" : "Bear marubozu",
    };
  }

  // Inside bar break
  if (
    prev.high > last.high &&
    prev.low < last.low &&
    bodyR < 0.4
  ) {
    return { direction: "SIDEWAYS", strength: 1, label: "Inside bar · wait" };
  }

  if (bodyR >= 0.55) {
    return {
      direction: last.bullish ? "UP" : "DOWN",
      strength: 4,
      label: last.bullish ? "Strong green body" : "Strong red body",
    };
  }

  return { direction: "SIDEWAYS", strength: 0, label: "No clear pattern" };
}

function layerWick(bars: Bar[]): RealMarketLayer {
  if (bars.length < 2) {
    return { direction: "SIDEWAYS", strength: 0, label: "Wick thin" };
  }
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const upR = last.upper / last.range;
  const loR = last.lower / last.range;
  const bodyR = last.body / last.range;

  if (bodyR <= 0.18 && upR >= 0.28 && loR >= 0.28) {
    return { direction: "SIDEWAYS", strength: 0, label: "Doji · both wicks" };
  }

  if (upR >= 0.38 && upR > loR + 0.12 && bodyR <= 0.45) {
    const twin = prev.upper / prev.range >= 0.32;
    return {
      direction: "DOWN",
      strength: twin ? 8 : 6,
      label: twin ? "Twin upper wick rejection" : "Upper wick rejection",
    };
  }
  if (loR >= 0.38 && loR > upR + 0.12 && bodyR <= 0.45) {
    const twin = prev.lower / prev.range >= 0.32;
    return {
      direction: "UP",
      strength: twin ? 8 : 6,
      label: twin ? "Twin lower wick rejection" : "Lower wick rejection",
    };
  }

  if (upR > loR + 0.2) {
    return { direction: "DOWN", strength: 3, label: "Upper wick pressure" };
  }
  if (loR > upR + 0.2) {
    return { direction: "UP", strength: 3, label: "Lower wick support" };
  }

  return { direction: "SIDEWAYS", strength: 0, label: "Wick neutral" };
}

/** Order flow: cumulative buy vs sell pressure (below/above midpoint). */
function layerOrderFlow(bars: Bar[]): RealMarketLayer {
  if (bars.length < 5) {
    return { direction: "SIDEWAYS", strength: 0, label: "Order flow thin" };
  }
  const window = bars.slice(-8);
  let buy = 0;
  let sell = 0;
  for (const b of window) {
    const w = Math.max(0.5, b.activity / 1000);
    buy += b.buyPressure * w;
    sell += b.sellPressure * w;
    // Close in upper/lower third = aggressive flow
    if (b.buyPressure >= 0.66) buy += 0.6 * w;
    if (b.sellPressure >= 0.66) sell += 0.6 * w;
  }
  const last = window[window.length - 1];
  if (last.buyPressure >= 0.7 && last.body / last.range >= 0.4) buy += 2;
  if (last.sellPressure >= 0.7 && last.body / last.range >= 0.4) sell += 2;

  // "Below/Above" — price vs VWAP-ish typical price mean
  const typical =
    window.reduce((s, b) => s + (b.high + b.low + b.close) / 3, 0) / window.length;
  if (last.close > typical) buy += 1.5;
  if (last.close < typical) sell += 1.5;

  const dir = vote(buy, sell, Math.max(0.8, (buy + sell) * 0.06));
  return {
    direction: dir,
    strength: Math.min(10, Math.max(buy, sell) / Math.max(1, window.length / 2)),
    label:
      dir === "UP"
        ? "Order flow above · buyers"
        : dir === "DOWN"
          ? "Order flow below · sellers"
          : "Order flow balanced",
  };
}

/**
 * Order blocks: last opposite impulse candle before displacement.
 * Bullish OB = last bearish candle before strong bull run; price revisiting = demand.
 */
function layerOrderBlock(bars: Bar[]): RealMarketLayer {
  if (bars.length < 10) {
    return { direction: "SIDEWAYS", strength: 0, label: "Order block thin" };
  }
  const last = bars[bars.length - 1];
  const look = bars.slice(-18);

  // Find recent bullish displacement (2+ strong greens)
  let bullOb: { top: number; bottom: number } | null = null;
  let bearOb: { top: number; bottom: number } | null = null;

  for (let i = 3; i < look.length - 1; i++) {
    const a = look[i - 1];
    const b = look[i];
    const c = look[i + 1];
    // Bearish candle then 2 bullish displacement → bullish OB = that bear candle
    if (
      a.bearish &&
      b.bullish &&
      c.bullish &&
      b.body > a.body * 0.8 &&
      c.close > a.high
    ) {
      bullOb = { top: Math.max(a.open, a.close), bottom: Math.min(a.open, a.close) };
    }
    // Bullish candle then 2 bearish displacement → bearish OB
    if (
      a.bullish &&
      b.bearish &&
      c.bearish &&
      b.body > a.body * 0.8 &&
      c.close < a.low
    ) {
      bearOb = { top: Math.max(a.open, a.close), bottom: Math.min(a.open, a.close) };
    }
  }

  let up = 0;
  let down = 0;
  let label = "No active order block";

  if (bullOb) {
    const inZone = last.low <= bullOb.top * 1.0004 && last.close >= bullOb.bottom;
    const held = last.close > bullOb.bottom && last.lower / last.range >= 0.2;
    if (inZone && (last.bullish || held)) {
      up += 5;
      label = "Bullish order block reaction";
    } else if (last.close > bullOb.top) {
      up += 1;
      label = "Above bullish OB";
    }
  }

  if (bearOb) {
    const inZone = last.high >= bearOb.bottom * 0.9996 && last.close <= bearOb.top;
    const held = last.close < bearOb.top && last.upper / last.range >= 0.2;
    if (inZone && (last.bearish || held)) {
      down += 5;
      label = "Bearish order block reaction";
    } else if (last.close < bearOb.bottom) {
      down += 1;
      label = "Below bearish OB";
    }
  }

  const dir = vote(up, down, 1.5);
  return { direction: dir, strength: Math.min(10, Math.max(up, down)), label };
}

/**
 * Fair Value Gap (ICT): 3-candle imbalance.
 * Bullish FVG: candle3.low > candle1.high (gap up left behind).
 * Bearish FVG: candle3.high < candle1.low.
 * Stronger when price retests the gap and rejects.
 */
function layerFvg(bars: Bar[]): RealMarketLayer {
  if (bars.length < 3) {
    return { direction: "SIDEWAYS", strength: 0, label: "FVG thin" };
  }

  type Gap = { kind: "BULL" | "BEAR"; top: number; bottom: number; age: number };
  const gaps: Gap[] = [];

  // Scan recent windows for unfilled / active FVGs
  const start = Math.max(2, bars.length - 16);
  for (let i = start; i < bars.length; i++) {
    const c1 = bars[i - 2];
    const c3 = bars[i];
    if (c3.low > c1.high) {
      gaps.push({
        kind: "BULL",
        top: c3.low,
        bottom: c1.high,
        age: bars.length - 1 - i,
      });
    }
    if (c3.high < c1.low) {
      gaps.push({
        kind: "BEAR",
        top: c1.low,
        bottom: c3.high,
        age: bars.length - 1 - i,
      });
    }
  }

  if (!gaps.length) {
    return { direction: "SIDEWAYS", strength: 0, label: "No FVG" };
  }

  const last = bars[bars.length - 1];
  let up = 0;
  let down = 0;
  let label = "FVG present";

  // Prefer freshest gap (smallest age)
  const sorted = [...gaps].sort((a, b) => a.age - b.age);
  const fresh = sorted[0];

  for (const g of sorted.slice(0, 4)) {
    const mid = (g.top + g.bottom) / 2;
    const size = Math.max(g.top - g.bottom, 1e-8);
    const inGap =
      last.low <= g.top && last.high >= g.bottom;
    const touching =
      (last.low <= g.top && last.low >= g.bottom) ||
      (last.high >= g.bottom && last.high <= g.top) ||
      (last.close <= g.top && last.close >= g.bottom);

    if (g.kind === "BULL") {
      // Fresh bullish imbalance still open → continuation UP
      if (g.age <= 1 && last.close > g.top) {
        up += 4;
        label = "Bullish FVG open";
      }
      // Retest into bullish FVG + rejection / close back up
      if (touching || inGap) {
        if (last.bullish || last.lower / last.range >= 0.28 || last.close >= mid) {
          up += 5;
          label = "Bullish FVG retest hold";
        } else if (last.close < g.bottom) {
          // Full fill through — imbalance invalidated / flip soft
          down += 1;
          label = "Bullish FVG filled";
        } else {
          up += 2;
          label = "Bullish FVG retest";
        }
      }
      // Size quality
      if (size / last.range >= 0.35 && g.age <= 3) up += 1;
    } else {
      if (g.age <= 1 && last.close < g.bottom) {
        down += 4;
        label = "Bearish FVG open";
      }
      if (touching || inGap) {
        if (last.bearish || last.upper / last.range >= 0.28 || last.close <= mid) {
          down += 5;
          label = "Bearish FVG retest hold";
        } else if (last.close > g.top) {
          up += 1;
          label = "Bearish FVG filled";
        } else {
          down += 2;
          label = "Bearish FVG retest";
        }
      }
      if (size / last.range >= 0.35 && g.age <= 3) down += 1;
    }
  }

  // If only fresh gap with no retest yet, still bias continuation
  if (up === 0 && down === 0) {
    if (fresh.kind === "BULL") {
      up += 3;
      label = "Bullish FVG";
    } else {
      down += 3;
      label = "Bearish FVG";
    }
  }

  const dir = vote(up, down, 1.5);
  return { direction: dir, strength: Math.min(10, Math.max(up, down)), label };
}

/** Market structure: simple HH/HL vs LH/LL + BOS. */
function layerStructure(bars: Bar[]): RealMarketLayer {
  if (bars.length < 10) {
    return { direction: "SIDEWAYS", strength: 0, label: "Structure thin" };
  }
  const swing = bars.slice(-12);
  const mid = Math.floor(swing.length / 2);
  const firstHi = Math.max(...swing.slice(0, mid).map((b) => b.high));
  const firstLo = Math.min(...swing.slice(0, mid).map((b) => b.low));
  const secondHi = Math.max(...swing.slice(mid).map((b) => b.high));
  const secondLo = Math.min(...swing.slice(mid).map((b) => b.low));
  const last = bars[bars.length - 1];

  let up = 0;
  let down = 0;
  if (secondHi > firstHi && secondLo > firstLo) up += 3; // HH + HL
  if (secondHi < firstHi && secondLo < firstLo) down += 3; // LH + LL

  // BOS
  if (last.close > firstHi) up += 3;
  if (last.close < firstLo) down += 3;

  const dir = vote(up, down, 1);
  return {
    direction: dir,
    strength: Math.min(10, Math.max(up, down)),
    label:
      dir === "UP"
        ? last.close > firstHi
          ? "Bullish BOS"
          : "HH/HL structure"
        : dir === "DOWN"
          ? last.close < firstLo
            ? "Bearish BOS"
            : "LH/LL structure"
          : "Structure range",
  };
}

export function analyzeRealMarket(candles: MarketCandle[]): RealMarketSignal {
  const bars = parseBars(candles);
  const emptyLayer = (label: string): RealMarketLayer => ({
    direction: "SIDEWAYS",
    strength: 0,
    label,
  });

  if (bars.length < 8) {
    return {
      direction: "SIDEWAYS",
      confidence: 48,
      alignedCount: 0,
      labels: ["Need more candles for Real Market engine"],
      layers: {
        macd: emptyLayer("MACD waiting"),
        ma: emptyLayer("MA waiting"),
        volume: emptyLayer("Volume waiting"),
        liquidity: emptyLayer("Liquidity waiting"),
        pattern: emptyLayer("Pattern waiting"),
        wick: emptyLayer("Wick waiting"),
        orderFlow: emptyLayer("Order flow waiting"),
        orderBlock: emptyLayer("Order block waiting"),
        fvg: emptyLayer("FVG waiting"),
        structure: emptyLayer("Structure waiting"),
      },
      summaryMarkdown: "*Real Market engine warming — need more candles.*",
    };
  }

  const closes = bars.map((b) => b.close);
  const layers = {
    macd: layerMacd(closes),
    ma: layerMa(closes),
    volume: layerVolume(bars),
    liquidity: layerLiquidity(bars),
    pattern: layerPattern(bars),
    wick: layerWick(bars),
    orderFlow: layerOrderFlow(bars),
    orderBlock: layerOrderBlock(bars),
    fvg: layerFvg(bars),
    structure: layerStructure(bars),
  };

  // Weighted vote — liquidity / wick / OB / FVG / MACD carry more for accuracy
  const weights: Record<keyof typeof layers, number> = {
    macd: 1.4,
    ma: 1.2,
    volume: 1.0,
    liquidity: 1.6,
    pattern: 1.3,
    wick: 1.5,
    orderFlow: 1.2,
    orderBlock: 1.5,
    fvg: 1.55,
    structure: 1.1,
  };

  let upScore = 0;
  let downScore = 0;
  const labels: string[] = [];

  (Object.keys(layers) as (keyof typeof layers)[]).forEach((key) => {
    const L = layers[key];
    const w = weights[key];
    if (L.direction === "UP") upScore += L.strength * w;
    if (L.direction === "DOWN") downScore += L.strength * w;
    if (L.strength >= 3 && L.direction !== "SIDEWAYS") {
      labels.push(L.label);
    }
  });

  const alignedUp = (Object.values(layers) as RealMarketLayer[]).filter(
    (l) => l.direction === "UP" && l.strength >= 2
  ).length;
  const alignedDown = (Object.values(layers) as RealMarketLayer[]).filter(
    (l) => l.direction === "DOWN" && l.strength >= 2
  ).length;

  let direction: Direction = "SIDEWAYS";
  if (upScore - downScore >= 4) direction = "UP";
  else if (downScore - upScore >= 4) direction = "DOWN";
  else if (alignedUp >= 5 && alignedUp > alignedDown) direction = "UP";
  else if (alignedDown >= 5 && alignedDown > alignedUp) direction = "DOWN";

  const dominant = Math.max(upScore, downScore);
  const total = upScore + downScore || 1;
  let confidence = Math.round(52 + (dominant / total) * 34);
  const alignedCount = direction === "UP" ? alignedUp : direction === "DOWN" ? alignedDown : 0;

  if (alignedCount >= 6) confidence = Math.min(90, confidence + 6);
  else if (alignedCount >= 4) confidence = Math.min(86, confidence + 3);
  else if (alignedCount <= 2 && direction !== "SIDEWAYS") {
    confidence = Math.max(54, confidence - 4);
  }

  // Require confluence: weak single-layer signals → soft HOLD
  if (direction !== "SIDEWAYS" && alignedCount < 3) {
    direction = "SIDEWAYS";
    confidence = Math.min(confidence, 55);
    labels.unshift("Weak confluence · wait");
  } else if (direction !== "SIDEWAYS") {
    labels.unshift(`Real confluence ×${alignedCount}`);
  }

  const summaryMarkdown = [
    `### Real Market Engine`,
    `* **Bias**: **${direction}** · confidence **${confidence}%** · layers **${alignedCount}/10**`,
    `* **MACD**: ${layers.macd.label}`,
    `* **MA**: ${layers.ma.label}`,
    `* **Volume**: ${layers.volume.label}`,
    `* **Liquidity**: ${layers.liquidity.label}`,
    `* **Pattern**: ${layers.pattern.label}`,
    `* **Wick**: ${layers.wick.label}`,
    `* **Order flow**: ${layers.orderFlow.label}`,
    `* **Order block**: ${layers.orderBlock.label}`,
    `* **FVG**: ${layers.fvg.label}`,
    `* **Structure**: ${layers.structure.label}`,
  ].join("\n");

  return {
    direction,
    confidence: Math.max(48, Math.min(90, confidence)),
    alignedCount,
    labels: labels.slice(0, 6),
    layers,
    summaryMarkdown,
  };
}

/** Blend Real engine with an existing direction (Gemini / intel). */
export function blendRealMarketSignal(
  baseDir: Direction,
  baseConf: number,
  real: RealMarketSignal
): { direction: Direction; confidence: number; labels: string[] } {
  const labels = [...real.labels];

  if (real.direction === "SIDEWAYS") {
    return {
      direction: baseDir,
      confidence: Math.max(50, Math.min(baseConf, real.confidence + 2)),
      labels,
    };
  }

  if (baseDir === "SIDEWAYS" || baseDir === real.direction) {
    return {
      direction: real.direction,
      confidence: Math.min(
        90,
        Math.round(real.confidence * 0.65 + Math.max(baseConf, 55) * 0.35)
      ),
      labels,
    };
  }

  // Conflict: trust Real engine when confluence is strong
  if (real.alignedCount >= 5) {
    labels.push("Real engine override");
    return {
      direction: real.direction,
      confidence: Math.max(60, Math.min(82, real.confidence - 2)),
      labels,
    };
  }

  labels.push("Real vs chart conflict · caution");
  return {
    direction: real.direction,
    confidence: Math.max(54, Math.min(68, Math.min(baseConf, real.confidence) - 4)),
    labels,
  };
}
