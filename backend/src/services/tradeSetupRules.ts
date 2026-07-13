import type { MarketCandle } from "./marketDataClient.js";
import type { Direction, MarketIntelligence } from "./marketIntelligence.js";
import { fetchDailyForexNews, type ForexNewsEvent } from "./forexNewsClient.js";

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
 * Used to boost direction / confidence — not as a hard HOLD hammer.
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

  // —— Shadow / wick analysis ——
  let wickDir: Direction = "SIDEWAYS";
  let wickStrength = 0;

  const pinBarDown = last.upperRatio >= 0.45 && last.bodyRatio <= 0.4 && last.lowerRatio < 0.25;
  const pinBarUp = last.lowerRatio >= 0.45 && last.bodyRatio <= 0.4 && last.upperRatio < 0.25;
  const marubozu =
    last.bodyRatio >= 0.68 && last.upperRatio <= 0.15 && last.lowerRatio <= 0.15;
  const engulfsPrev =
    last.bodyRatio > 0.5 &&
    ((last.bullish && prev.bearish && last.close >= prev.open && last.open <= prev.close) ||
      (last.bearish && prev.bullish && last.close <= prev.open && last.open >= prev.close));

  if (pinBarUp) {
    wickDir = "UP";
    wickStrength = 3 + Math.min(3, Math.round(last.lowerRatio * 4));
    labels.push("Lower shadow rejection · BUY bias");
  } else if (pinBarDown) {
    wickDir = "DOWN";
    wickStrength = 3 + Math.min(3, Math.round(last.upperRatio * 4));
    labels.push("Upper shadow rejection · SELL bias");
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
  } else if (last.upperRatio > last.lowerRatio + 0.15) {
    wickDir = "DOWN";
    wickStrength = 1;
    labels.push("Upper wick pressure");
  } else if (last.lowerRatio > last.upperRatio + 0.15) {
    wickDir = "UP";
    wickStrength = 1;
    labels.push("Lower wick support");
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
  pair: string
): Promise<SetupGateResult> {
  const filters: string[] = [];
  let dir = direction;
  let conf = confidence;

  const wickVol = analyzeWickAndVolume(candles);
  const blended = blendDirection(dir, wickVol, true);
  dir = blended.direction;
  conf = Math.min(88, conf + blended.boost * 1.5);
  filters.push(...blended.labels.slice(0, 2));

  const ind = computeIndicators(candles);
  if (ind.ema50 != null && ind.ema200 != null) {
    const bullTrend = ind.ema50 > ind.ema200;
    const bearTrend = ind.ema50 < ind.ema200;
    if (bullTrend) {
      filters.push("EMA uptrend");
      if (dir === "DOWN" && wickVol.wickStrength < 4) {
        // Soft: flip to BUY with trend instead of HOLD
        dir = "UP";
        conf = Math.max(58, Math.min(conf, 72));
        filters.push("Aligned to EMA uptrend");
      } else if (dir === "UP") conf = Math.min(88, conf + 4);
    } else if (bearTrend) {
      filters.push("EMA downtrend");
      if (dir === "UP" && wickVol.wickStrength < 4) {
        dir = "DOWN";
        conf = Math.max(58, Math.min(conf, 72));
        filters.push("Aligned to EMA downtrend");
      } else if (dir === "DOWN") conf = Math.min(88, conf + 4);
    }
  }

  if (ind.rsi14 != null) {
    filters.push(`RSI ${ind.rsi14.toFixed(0)}`);
    // Soft RSI: only block extreme + conflicting wick
    if (dir === "UP" && ind.rsi14 > 78 && wickVol.wickDir !== "UP") {
      conf = Math.min(conf, 62);
      filters.push("RSI hot · caution");
    } else if (dir === "DOWN" && ind.rsi14 < 22 && wickVol.wickDir !== "DOWN") {
      conf = Math.min(conf, 62);
      filters.push("RSI washed · caution");
    } else if (dir === "UP" && ind.rsi14 < 55) conf = Math.min(88, conf + 2);
    else if (dir === "DOWN" && ind.rsi14 > 45) conf = Math.min(88, conf + 2);
  }

  // Volume soft: never force HOLD
  if (wickVol.volumeStrength >= 2) conf = Math.min(88, conf + 3);
  else if (wickVol.volumeStrength === 0) conf = Math.max(52, conf - 2);

  const news = await findNewsBlock(pair);
  if (news.blocked) {
    dir = "SIDEWAYS";
    conf = Math.min(conf, 45);
    filters.push(news.label);
  }

  // Last resort fill from wick if still empty
  if (dir === "SIDEWAYS" && wickVol.wickDir !== "SIDEWAYS" && wickVol.wickStrength >= 2) {
    dir = wickVol.wickDir;
    conf = Math.max(60, Math.min(78, conf + wickVol.wickStrength * 2));
    filters.push("Wick fill");
  }

  const blocked = Boolean(news.blocked);
  return {
    direction: dir,
    confidence: Math.round(Math.max(48, Math.min(88, conf))),
    blocked,
    filters: filters.filter(Boolean).slice(0, 4),
    note: blocked
      ? "REAL · news window HOLD"
      : dir === "SIDEWAYS"
        ? "REAL · wick/volume unclear"
        : "REAL · wick + volume scored",
    martingaleHint: "none",
  };
}

export function applyOtcMarketSetup(
  direction: Direction,
  confidence: number,
  intel: MarketIntelligence | null,
  candles: MarketCandle[]
): SetupGateResult {
  const filters: string[] = [];
  let dir = direction;
  let conf = confidence;

  const wickVol = analyzeWickAndVolume(candles);
  const blended = blendDirection(dir, wickVol, true);
  dir = blended.direction;
  conf = Math.min(88, conf + blended.boost * 1.8);
  filters.push(...blended.labels.slice(0, 2));

  const expansion = intel?.otcInsight?.toLowerCase().includes("expansion") ?? false;
  const momentum = intel?.momentum ?? "NEUTRAL";
  const msnr = intel?.msnr;
  const live = intel?.nextCandleDirection ?? "SIDEWAYS";

  // Momentum / expansion: follow, don't HOLD
  if (expansion && live !== "SIDEWAYS") {
    dir = live;
    conf = Math.max(conf, 70);
    filters.push("OTC expansion follow");
  } else if (momentum === "BULLISH" || momentum === "BEARISH") {
    const follow: Direction = momentum === "BULLISH" ? "UP" : "DOWN";
    if (dir === "SIDEWAYS" || dir === follow) {
      dir = follow;
      conf = Math.max(conf, 64);
      filters.push(`Momentum ${momentum}`);
    } else if (wickVol.wickStrength < 3) {
      // Weak reverse vs streak → follow streak (not HOLD)
      dir = follow;
      conf = Math.max(60, Math.min(conf, 70));
      filters.push("Follow OTC streak");
    }
  }

  // S&R + wick rejection → take trade
  if (intel?.priceAction.rejection || msnr?.signal === "SBR" || msnr?.signal === "RBS") {
    let srDir: Direction = "SIDEWAYS";
    if (msnr?.signal === "SBR") srDir = "UP";
    else if (msnr?.signal === "RBS") srDir = "DOWN";
    else if (wickVol.wickDir === "UP" || wickVol.wickDir === "DOWN") srDir = wickVol.wickDir;

    if (srDir !== "SIDEWAYS") {
      if (dir === "SIDEWAYS" || dir === srDir || wickVol.wickStrength >= 2) {
        dir = srDir;
        conf = Math.min(88, Math.max(conf, 70));
        filters.push(`S&R ${msnr?.signal || "reject"}`);
      }
    }
  }

  if (dir === "SIDEWAYS" && live !== "SIDEWAYS" && (intel?.confidencePct ?? 0) >= 55) {
    dir = live;
    conf = Math.max(60, intel!.confidencePct);
    filters.push("Live OTC fill");
  }

  if (dir === "SIDEWAYS" && wickVol.wickDir !== "SIDEWAYS") {
    dir = wickVol.wickDir;
    conf = Math.max(62, Math.min(76, conf + 4));
    filters.push("OTC wick fill");
  }

  return {
    direction: dir,
    confidence: Math.round(Math.max(52, Math.min(88, conf))),
    blocked: false,
    filters: filters.filter(Boolean).slice(0, 4),
    note:
      dir === "SIDEWAYS"
        ? "OTC · waiting tick"
        : "OTC · wick/volume · 1-step MTG",
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
    input.pair
  );
}
