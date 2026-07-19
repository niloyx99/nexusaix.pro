import type { MarketCandle } from "../market/marketDataClient.js";
import type { Bias, Direction, MarketIntelligence } from "./marketIntelligence.js";
import { analyzeLmpConfluence, type LmpConfluence } from "./lmpConfluence.js";
import { fetchDailyForexNews, type ForexNewsEvent } from "../news/forexNewsClient.js";
import { analyzeRealMarket } from "./realMarketAnalysis.js";

export type SetupMode = "REAL" | "OTC";

export interface SetupGateResult {
  direction: Direction;
  confidence: number;
  blocked: boolean;
  filters: string[];
  note: string;
  martingaleHint: "1-step" | "none";
}

export interface WickVolumeScore {
  wickDir: Direction;
  wickStrength: number;
  volumeDir: Direction;
  volumeStrength: number;
  volumeRatio: number;
  hasVolumeData: boolean;
  labels: string[];
}

interface IndicatorSnapshot {
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  closes: number[];
}

const NEWS_CACHE_MS = 120_000;
let newsCache: { at: number; events: ForexNewsEvent[] } | null = null;

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function candleParts(c: MarketCandle) {
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  const close = Number(c.close);
  const range = Math.max(high - low, 1e-8);
  const body = Math.abs(close - open);
  const upper = high - Math.max(open, close);
  const lower = Math.min(open, close) - low;
  const vol = Number(c.tick_volume ?? 0);
  return {
    open,
    high,
    low,
    close,
    range,
    body,
    upper,
    lower,
    vol: Number.isFinite(vol) && vol > 0 ? vol : 0,
    bullish: close > open,
    bearish: close < open,
    bodyRatio: body / range,
    upperRatio: upper / range,
    lowerRatio: lower / range,
    /** Range proxy when tick_volume missing */
    activity: (Number.isFinite(vol) && vol > 0 ? vol : body * 1e6) || range,
  };
}

export function computeIndicators(candles: MarketCandle[]): IndicatorSnapshot {
  const closes = candles
    .map((c) => Number(c.close))
    .filter((n) => Number.isFinite(n));

  return {
    ema50: closes.length >= 50 ? ema(closes, 50) : closes.length >= 20 ? ema(closes, 20) : null,
    ema200: closes.length >= 200 ? ema(closes, 200) : closes.length >= 80 ? ema(closes, 80) : null,
    rsi14: rsi(closes, 14),
    closes,
  };
}

/**
 * Candlestick shadow/wick + volume (or range activity) for REAL & OTC.
 * Liquidity-aware: rejection at recent highs/lows gets stronger weight.
 */
export function analyzeWickAndVolume(candles: MarketCandle[]): WickVolumeScore {
  const labels: string[] = [];
  if (candles.length < 2) {
    return {
      wickDir: "SIDEWAYS",
      wickStrength: 0,
      volumeDir: "SIDEWAYS",
      volumeStrength: 0,
      volumeRatio: 1,
      hasVolumeData: false,
      labels,
    };
  }

  const parsed = candles.map(candleParts);
  const last = parsed[parsed.length - 1];
  const prev = parsed[parsed.length - 2];
  const recent = parsed.slice(-6);
  const look = parsed.slice(-10, -1);
  const recentHigh = look.length ? Math.max(...look.map((c) => c.high)) : last.high;
  const recentLow = look.length ? Math.min(...look.map((c) => c.low)) : last.low;
  const atHigh = last.high >= recentHigh * 0.9997;
  const atLow = last.low <= recentLow * 1.0003;

  // —— Shadow / wick analysis ——
  let wickDir: Direction = "SIDEWAYS";
  let wickStrength = 0;

  // Doji both-side shadows → no directional wick call
  if (
    last.bodyRatio <= 0.18 &&
    last.upperRatio >= 0.28 &&
    last.lowerRatio >= 0.28
  ) {
    labels.push("Doji · both shadows · no wick bias");
  } else {
    const pinBarDown =
      last.upperRatio >= (atHigh ? 0.36 : 0.42) &&
      last.bodyRatio <= 0.42 &&
      last.lowerRatio < last.upperRatio * 0.7;
    const pinBarUp =
      last.lowerRatio >= (atLow ? 0.36 : 0.42) &&
      last.bodyRatio <= 0.42 &&
      last.upperRatio < last.lowerRatio * 0.7;
    const marubozu =
      last.bodyRatio >= 0.68 && last.upperRatio <= 0.15 && last.lowerRatio <= 0.15;
    const engulfsPrev =
      last.bodyRatio > 0.5 &&
      ((last.bullish && prev.bearish && last.close >= prev.open && last.open <= prev.close) ||
        (last.bearish && prev.bullish && last.close <= prev.open && last.open >= prev.close));

    // Liquidity pierce + reject (shadow close back)
    const bslReject =
      last.high > recentHigh &&
      last.close < recentHigh &&
      last.upperRatio >= 0.3;
    const sslReject =
      last.low < recentLow &&
      last.close > recentLow &&
      last.lowerRatio >= 0.3;

    if (bslReject || pinBarDown) {
      wickDir = "DOWN";
      wickStrength = bslReject
        ? 5 + Math.min(2, Math.round(last.upperRatio * 3))
        : 3 + Math.min(3, Math.round(last.upperRatio * 4));
      if (atHigh) wickStrength = Math.min(8, wickStrength + 1);
      labels.push(
        bslReject
          ? "BSL shadow reject · SELL bias"
          : "Upper shadow rejection · SELL bias"
      );
    } else if (sslReject || pinBarUp) {
      wickDir = "UP";
      wickStrength = sslReject
        ? 5 + Math.min(2, Math.round(last.lowerRatio * 3))
        : 3 + Math.min(3, Math.round(last.lowerRatio * 4));
      if (atLow) wickStrength = Math.min(8, wickStrength + 1);
      labels.push(
        sslReject
          ? "SSL shadow reject · BUY bias"
          : "Lower shadow rejection · BUY bias"
      );
    } else if (
      last.upperRatio >= 0.32 &&
      prev.upperRatio >= 0.32 &&
      last.upperRatio > last.lowerRatio
    ) {
      wickDir = "DOWN";
      wickStrength = 4;
      labels.push("Twin upper shadows · SELL");
    } else if (
      last.lowerRatio >= 0.32 &&
      prev.lowerRatio >= 0.32 &&
      last.lowerRatio > last.upperRatio
    ) {
      wickDir = "UP";
      wickStrength = 4;
      labels.push("Twin lower shadows · BUY");
    } else if (marubozu) {
      wickDir = last.bullish ? "UP" : "DOWN";
      wickStrength = 4;
      labels.push(last.bullish ? "Full body green · continuation UP" : "Full body red · continuation DOWN");
    } else if (engulfsPrev) {
      wickDir = last.bullish ? "UP" : "DOWN";
      wickStrength = 3;
      labels.push(last.bullish ? "Bullish engulf" : "Bearish engulf");
    } else if (last.bodyRatio >= 0.55) {
      wickDir = last.bullish ? "UP" : "DOWN";
      wickStrength = 2;
      labels.push(last.bullish ? "Strong bullish body" : "Strong bearish body");
    } else if (last.upperRatio > last.lowerRatio + 0.18) {
      wickDir = "DOWN";
      wickStrength = 2;
      labels.push("Upper wick pressure");
    } else if (last.lowerRatio > last.upperRatio + 0.18) {
      wickDir = "UP";
      wickStrength = 2;
      labels.push("Lower wick support");
    }
  }

  // —— Volume / activity ——
  const hasVolumeData = parsed.some((p) => p.vol > 0);
  const activities = recent.map((p) => (hasVolumeData ? p.vol : p.activity));
  const prevAct = hasVolumeData ? prev.vol || prev.activity : prev.activity;
  const avgAct =
    activities.slice(0, -1).reduce((a, b) => a + b, 0) /
      Math.max(1, activities.length - 1) || 1;
  const volumeRatio = prevAct / avgAct;

  let volumeDir: Direction = last.bullish ? "UP" : last.bearish ? "DOWN" : "SIDEWAYS";
  let volumeStrength = 0;

  if (volumeRatio >= 1.25) {
    volumeStrength = 3;
    labels.push(
      hasVolumeData
        ? `Volume surge ×${volumeRatio.toFixed(2)}`
        : `Range surge ×${volumeRatio.toFixed(2)}`
    );
  } else if (volumeRatio >= 1.0) {
    volumeStrength = 2;
    labels.push(hasVolumeData ? "Volume above avg" : "Activity above avg");
  } else if (volumeRatio >= 0.75) {
    volumeStrength = 1;
    labels.push("Volume normal");
  } else {
    volumeStrength = 0;
    labels.push("Volume soft · still tradable");
  }

  // High volume + clear body locks direction
  if (volumeStrength >= 2 && last.bodyRatio >= 0.4) {
    volumeDir = last.bullish ? "UP" : "DOWN";
    volumeStrength += 1;
  }

  // Volume confirms wick rejection at extreme
  if (wickStrength >= 3 && volumeStrength >= 2 && wickDir !== "SIDEWAYS") {
    wickStrength = Math.min(8, wickStrength + 1);
    labels.push("Vol confirms shadow");
  }

  return {
    wickDir,
    wickStrength,
    volumeDir,
    volumeStrength,
    volumeRatio,
    hasVolumeData,
    labels,
  };
}

function blendDirection(
  base: Direction,
  wick: WickVolumeScore,
  preferFill: boolean
): { direction: Direction; boost: number; labels: string[] } {
  const labels: string[] = [];
  let dir = base;
  let boost = 0;

  const vote = (d: Direction, w: number, tag: string) => {
    if (d === "SIDEWAYS" || w <= 0) return;
    if (dir === "SIDEWAYS") {
      dir = d;
      boost += w;
      labels.push(tag);
    } else if (dir === d) {
      boost += w;
      labels.push(tag);
    } else if (w >= 4 && preferFill) {
      // Strong wick/volume can override a weak conflicting base
      dir = d;
      boost = w;
      labels.push(`${tag} (override)`);
    } else {
      boost -= Math.min(2, w);
    }
  };

  vote(wick.wickDir, wick.wickStrength, wick.labels[0] || "Wick");
  vote(wick.volumeDir, wick.volumeStrength, wick.labels.find((l) => /volume|activity|range/i.test(l)) || "Volume");

  if (dir === "SIDEWAYS" && preferFill) {
    if (wick.wickDir !== "SIDEWAYS" && wick.wickStrength >= 2) {
      dir = wick.wickDir;
      boost = wick.wickStrength;
      labels.push("Filled from wick");
    } else if (wick.volumeDir !== "SIDEWAYS" && wick.volumeStrength >= 2) {
      dir = wick.volumeDir;
      boost = wick.volumeStrength;
      labels.push("Filled from volume");
    }
  }

  return { direction: dir, boost, labels };
}

/** Soft quality gate: prefer shadow rejection / liquidity; mask weak noise fills. */
function applyShadowLiquidityQuality(
  dir: Direction,
  conf: number,
  wickVol: WickVolumeScore,
  intel: MarketIntelligence | null,
  filters: string[]
): { direction: Direction; confidence: number } {
  if (dir === "SIDEWAYS") return { direction: dir, confidence: conf };

  const sweep = intel?.liquiditySweep;
  const rejection = Boolean(intel?.priceAction.rejection);
  const strongWick = wickVol.wickStrength >= 3 && wickVol.wickDir === dir;
  const sweepAligns =
    (sweep?.type === "SSL_SWEEP" && dir === "UP") ||
    (sweep?.type === "BSL_SWEEP" && dir === "DOWN");
  const sweepConflicts =
    (sweep?.type === "SSL_SWEEP" && dir === "DOWN") ||
    (sweep?.type === "BSL_SWEEP" && dir === "UP");

  // Best case: liquidity grab + shadow in same direction
  if (sweepAligns && (rejection || strongWick)) {
    return {
      direction: dir,
      confidence: Math.min(90, conf + 5),
    };
  }

  if (sweepAligns) {
    filters.push("Liq sweep aligned");
    return { direction: dir, confidence: Math.min(88, conf + 3) };
  }

  if (strongWick && rejection) {
    filters.push("Shadow reject quality");
    return { direction: dir, confidence: Math.min(88, conf + 3) };
  }

  // Fight liquidity mask → trust the sweep (smarter money)
  if (sweepConflicts && sweep?.detected) {
    const flip: Direction = sweep.type === "SSL_SWEEP" ? "UP" : "DOWN";
    filters.push("Liq mask override");
    return { direction: flip, confidence: Math.max(60, Math.min(78, conf)) };
  }

  // Weak body-only signal without wick/liq → cut quality
  if (
    wickVol.wickStrength < 2 &&
    !rejection &&
    !sweep?.detected &&
    wickVol.volumeStrength < 2
  ) {
    filters.push("Weak shadow/liq · caution");
    return { direction: dir, confidence: Math.max(52, Math.min(conf, 64)) };
  }

  // Wick fights direction without sweep support
  if (
    wickVol.wickDir !== "SIDEWAYS" &&
    wickVol.wickDir !== dir &&
    wickVol.wickStrength >= 4 &&
    !sweepAligns
  ) {
    filters.push("Shadow conflict");
    return {
      direction: wickVol.wickDir,
      confidence: Math.max(58, Math.min(74, conf)),
    };
  }

  return { direction: dir, confidence: conf };
}

/** LMP soft confirm only — never flip direction (override caused poor signals). */
function applyLmpGate(
  direction: Direction,
  confidence: number,
  candles: MarketCandle[],
  filters: string[],
  _preferFill: boolean
): { direction: Direction; confidence: number } {
  const lmp: LmpConfluence = analyzeLmpConfluence(candles);
  let conf = confidence;

  if (lmp.direction === "SIDEWAYS" || direction === "SIDEWAYS") {
    return { direction, confidence: conf };
  }

  if (lmp.aligned && lmp.direction === direction) {
    conf = Math.min(86, conf + 2);
  } else if (lmp.aligned && lmp.direction !== direction) {
    // Conflict with primary SMC/wick signal → slight caution, do not flip
    conf = Math.max(54, conf - 3);
  }

  return { direction, confidence: conf };
}

function pairCurrencies(pair: string): string[] {
  const base = pair.replace(/_otc$/i, "").toUpperCase();
  if (base.length >= 6) return [base.slice(0, 3), base.slice(3, 6)];
  return [];
}

function isHighImpact(event: ForexNewsEvent): boolean {
  const impact = event.impact.toLowerCase();
  const name = event.event.toLowerCase();
  if (impact === "high" || impact.includes("red")) return true;
  return /\b(cpi|nfp|fomc|interest rate|non-farm|payroll|powell)\b/.test(name);
}

async function loadHighImpactNews(): Promise<ForexNewsEvent[]> {
  const now = Date.now();
  if (newsCache && now - newsCache.at < NEWS_CACHE_MS) return newsCache.events;
  try {
    const { events } = await Promise.race([
      fetchDailyForexNews(),
      new Promise<{ events: ForexNewsEvent[] }>((resolve) =>
        setTimeout(() => resolve({ events: newsCache?.events ?? [] }), 1800)
      ),
    ]);
    const high = events.filter(isHighImpact);
    if (high.length) newsCache = { at: now, events: high };
    return high;
  } catch {
    return newsCache?.events ?? [];
  }
}

/** Only hard-block on mega news within ±10m (narrower = fewer HOLDs). */
export async function findNewsBlock(
  pair: string,
  nowMs = Date.now()
): Promise<{ blocked: boolean; label: string }> {
  const currencies = pairCurrencies(pair);
  if (!currencies.length) return { blocked: false, label: "" };

  const events = await loadHighImpactNews();
  const windowMs = 10 * 60 * 1000;

  for (const event of events) {
    const t = event.timeUtcMs || 0;
    if (!t || Math.abs(nowMs - t) > windowMs) continue;
    const cur = event.currency.toUpperCase();
    if (cur !== "USD" && !currencies.includes(cur)) continue;
    if (!/\b(cpi|nfp|fomc|interest rate|non-farm|payroll|powell)\b/i.test(event.event) && cur !== "USD") {
      continue;
    }
    const mins = Math.round((t - nowMs) / 60000);
    const when = mins === 0 ? "now" : mins > 0 ? `in ${mins}m` : `${Math.abs(mins)}m ago`;
    return { blocked: true, label: `News · ${event.currency} ${event.event} (${when})` };
  }
  return { blocked: false, label: "" };
}

export async function applyRealMarketSetup(
  direction: Direction,
  confidence: number,
  candles: MarketCandle[],
  pair: string,
  intel: MarketIntelligence | null = null
): Promise<SetupGateResult> {
  const filters: string[] = [];
  let dir = direction;
  let conf = confidence;

  const wickVol = analyzeWickAndVolume(candles);
  const blended = blendDirection(dir, wickVol, true);
  dir = blended.direction;
  conf = Math.min(88, conf + blended.boost * 1.5);
  filters.push(...blended.labels.slice(0, 2));

  const lmpGate = applyLmpGate(dir, conf, candles, filters, true);
  dir = lmpGate.direction;
  conf = lmpGate.confidence;

  const quality = applyShadowLiquidityQuality(dir, conf, wickVol, intel, filters);
  dir = quality.direction;
  conf = quality.confidence;

  // Professional Real layers (MACD/MA/Vol/Liq/Pattern/Wick/OF/OB/Structure)
  if (candles.length >= 8) {
    const real = analyzeRealMarket(candles);
    filters.push(...real.labels.slice(0, 2));
    if (real.direction !== "SIDEWAYS" && real.alignedCount >= 3) {
      if (dir === "SIDEWAYS" || dir === real.direction) {
        dir = real.direction;
        conf = Math.min(90, Math.round(conf * 0.4 + real.confidence * 0.6));
      } else if (real.alignedCount >= 5) {
        dir = real.direction;
        conf = Math.max(60, Math.min(84, real.confidence));
        filters.push("Real confluence override");
      } else {
        conf = Math.max(54, Math.min(conf, 68));
        filters.push("Real layer conflict");
      }
    } else if (real.direction === "SIDEWAYS" && real.alignedCount < 3) {
      conf = Math.max(52, Math.min(conf, 64));
      filters.push("Weak Real confluence");
    }
  }

  const ind = computeIndicators(candles);
  if (ind.ema50 != null && ind.ema200 != null) {
    const bullTrend = ind.ema50 > ind.ema200;
    const bearTrend = ind.ema50 < ind.ema200;
    // Don't EMA-flip when strong shadow/liquidity already set direction
    const hardWick = wickVol.wickStrength >= 4 || Boolean(intel?.liquiditySweep.detected);
    if (bullTrend) {
      filters.push("EMA uptrend");
      if (dir === "DOWN" && wickVol.wickStrength < 4 && !hardWick) {
        dir = "UP";
        conf = Math.max(58, Math.min(conf, 72));
        filters.push("Aligned to EMA uptrend");
      } else if (dir === "UP") conf = Math.min(88, conf + 4);
    } else if (bearTrend) {
      filters.push("EMA downtrend");
      if (dir === "UP" && wickVol.wickStrength < 4 && !hardWick) {
        dir = "DOWN";
        conf = Math.max(58, Math.min(conf, 72));
        filters.push("Aligned to EMA downtrend");
      } else if (dir === "DOWN") conf = Math.min(88, conf + 4);
    }
  }

  if (ind.rsi14 != null) {
    filters.push(`RSI ${ind.rsi14.toFixed(0)}`);
    if (dir === "UP" && ind.rsi14 > 78 && wickVol.wickDir !== "UP") {
      conf = Math.min(conf, 62);
      filters.push("RSI hot · caution");
    } else if (dir === "DOWN" && ind.rsi14 < 22 && wickVol.wickDir !== "DOWN") {
      conf = Math.min(conf, 62);
      filters.push("RSI washed · caution");
    } else if (dir === "UP" && ind.rsi14 < 55) conf = Math.min(88, conf + 2);
    else if (dir === "DOWN" && ind.rsi14 > 45) conf = Math.min(88, conf + 2);
  }

  if (wickVol.volumeStrength >= 2) conf = Math.min(88, conf + 3);
  else if (wickVol.volumeStrength === 0) conf = Math.max(52, conf - 2);

  const news = await findNewsBlock(pair);
  if (news.blocked) {
    dir = "SIDEWAYS";
    conf = Math.min(conf, 45);
    filters.push(news.label);
  }

  if (dir === "SIDEWAYS" && wickVol.wickDir !== "SIDEWAYS" && wickVol.wickStrength >= 2) {
    dir = wickVol.wickDir;
    conf = Math.max(60, Math.min(78, conf + wickVol.wickStrength * 2));
    filters.push("Wick fill");
  }

  const blocked = Boolean(news.blocked);
  return {
    direction: dir,
    confidence: Math.round(Math.max(48, Math.min(90, conf))),
    blocked,
    filters: filters.filter(Boolean).slice(0, 5),
    note: blocked
      ? "REAL · news window HOLD"
      : dir === "SIDEWAYS"
        ? "REAL · wick/volume unclear"
        : "REAL · MACD+MA+Vol+Liq+Wick+OF+OB+FVG",
    martingaleHint: "none",
  };
}

export function analyzeOtcSimpleEngine(candles: MarketCandle[]): {
  direction: Direction;
  confidence: number;
  wickVol: WickVolumeScore;
  lmp: LmpConfluence;
  labels: string[];
  momentum: Bias;
} {
  const wickVol = analyzeWickAndVolume(candles);
  const lmp = analyzeLmpConfluence(candles);
  const labels: string[] = [];

  // Short momentum from last closes
  let momentum: Bias = "NEUTRAL";
  if (candles.length >= 4) {
    const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
    const last3 = closes.slice(-3);
    if (last3.length === 3) {
      if (last3[2] > last3[1] && last3[1] >= last3[0]) momentum = "BULLISH";
      else if (last3[2] < last3[1] && last3[1] <= last3[0]) momentum = "BEARISH";
    }
  }

  let up = 0;
  let down = 0;

  // 1) Wick / shadow
  if (wickVol.wickDir === "UP") up += wickVol.wickStrength;
  if (wickVol.wickDir === "DOWN") down += wickVol.wickStrength;
  if (wickVol.wickStrength > 0 && wickVol.labels[0]) labels.push(wickVol.labels[0]);

  // 2) Volume / activity
  if (wickVol.volumeDir === "UP") up += wickVol.volumeStrength;
  if (wickVol.volumeDir === "DOWN") down += wickVol.volumeStrength;
  const volLabel = wickVol.labels.find((l) => /volume|activity|range|surge/i.test(l));
  if (volLabel) labels.push(volLabel);

  // Wick+volume confluence bonus
  if (
    wickVol.wickDir !== "SIDEWAYS" &&
    wickVol.wickDir === wickVol.volumeDir &&
    wickVol.wickStrength >= 2 &&
    wickVol.volumeStrength >= 2
  ) {
    if (wickVol.wickDir === "UP") up += 2;
    else down += 2;
    labels.push("Wick+volume aligned");
  }

  // 3) LMP
  if (lmp.direction === "UP") up += Math.max(1, Math.round(lmp.score / 2));
  if (lmp.direction === "DOWN") down += Math.max(1, Math.round(lmp.score / 2));
  if (lmp.aligned) {
    if (lmp.direction === "UP") up += 3;
    if (lmp.direction === "DOWN") down += 3;
    labels.push(`LMP aligned ${lmp.direction}`);
  } else if (lmp.score >= 7) {
    labels.push(lmp.labels[0] || "LMP majority");
  }

  // Soft short momentum (small weight)
  if (momentum === "BULLISH") up += 1;
  if (momentum === "BEARISH") down += 1;

  const diff = up - down;
  let direction: Direction = "SIDEWAYS";
  if (diff >= 3) direction = "UP";
  else if (diff <= -3) direction = "DOWN";
  else if (lmp.aligned && lmp.direction !== "SIDEWAYS") direction = lmp.direction;
  else if (wickVol.wickStrength >= 4 && wickVol.wickDir !== "SIDEWAYS") direction = wickVol.wickDir;
  else if (wickVol.wickDir !== "SIDEWAYS" && wickVol.wickDir === wickVol.volumeDir) {
    direction = wickVol.wickDir;
  }

  const dominant = Math.max(up, down);
  const total = up + down || 1;
  let confidence = Math.min(88, Math.max(54, Math.round(52 + (dominant / total) * 34)));
  if (lmp.aligned && lmp.direction === direction) confidence = Math.min(90, confidence + lmp.confidenceBoost);
  if (
    wickVol.wickDir === direction &&
    wickVol.volumeDir === direction &&
    wickVol.wickStrength >= 3
  ) {
    confidence = Math.min(90, confidence + 4);
  }
  if (direction === "SIDEWAYS") confidence = Math.min(confidence, 58);

  return {
    direction,
    confidence,
    wickVol,
    lmp,
    labels: labels.slice(0, 5),
    momentum,
  };
}

export function applyOtcMarketSetup(
  direction: Direction,
  confidence: number,
  _intel: MarketIntelligence | null,
  candles: MarketCandle[]
): SetupGateResult {
  if (candles.length < 2) {
    return {
      direction: "SIDEWAYS",
      confidence: 52,
      blocked: false,
      filters: [],
      note: "OTC · waiting candles",
      martingaleHint: "1-step",
    };
  }

  const simple = analyzeOtcSimpleEngine(candles);
  // Prefer simple engine; keep fusion direction only if simple is flat
  let dir = simple.direction;
  let conf = simple.confidence;
  if (dir === "SIDEWAYS" && direction !== "SIDEWAYS") {
    dir = direction;
    conf = Math.max(58, Math.min(72, confidence));
  } else if (dir !== "SIDEWAYS" && direction === dir) {
    conf = Math.min(90, Math.max(conf, confidence));
  }

  return {
    direction: dir,
    confidence: Math.round(Math.max(52, Math.min(90, conf))),
    blocked: false,
    filters: simple.labels.slice(0, 5),
    note:
      dir === "SIDEWAYS"
        ? "OTC · wick/volume/LMP waiting"
        : "OTC · wick + volume + LMP",
    martingaleHint: "1-step",
  };
}

export async function applyTradeSetupRules(input: {
  isOtc: boolean;
  direction: Direction;
  confidence: number;
  candles: MarketCandle[];
  pair: string;
  intel: MarketIntelligence | null;
}): Promise<SetupGateResult> {
  if (input.isOtc) {
    return applyOtcMarketSetup(
      input.direction,
      input.confidence,
      input.intel,
      input.candles
    );
  }
  return applyRealMarketSetup(
    input.direction,
    input.confidence,
    input.candles,
    input.pair,
    input.intel
  );
}
