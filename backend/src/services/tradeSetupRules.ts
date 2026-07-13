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

interface IndicatorSnapshot {
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  volumeOk: boolean;
  volumeRatio: number;
  closes: number[];
}

const NEWS_CACHE_MS = 90_000;
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

function volumes(candles: MarketCandle[]): number[] {
  return candles.map((c) => {
    const v = Number(c.tick_volume ?? 0);
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
}

export function computeIndicators(candles: MarketCandle[]): IndicatorSnapshot {
  const closes = candles
    .map((c) => Number(c.close))
    .filter((n) => Number.isFinite(n));
  const vols = volumes(candles);
  const last5 = vols.slice(-6, -1);
  const prev = vols.length >= 2 ? vols[vols.length - 2] : 0;
  const avg5 = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : 0;
  const volumeRatio = avg5 > 0 ? prev / avg5 : 1;
  // If feed has no volume, don't hard-block — treat as neutral pass.
  const hasVolume = vols.some((v) => v > 0);

  return {
    ema50: closes.length >= 50 ? ema(closes, 50) : null,
    ema200: closes.length >= 200 ? ema(closes, 200) : null,
    rsi14: rsi(closes, 14),
    volumeOk: !hasVolume || (avg5 > 0 && prev >= avg5 * 1.05),
    volumeRatio: hasVolume ? volumeRatio : 1,
    closes,
  };
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
  return /\b(cpi|nfp|fomc|interest rate|non-farm|payroll|gdp|powell)\b/.test(name);
}

async function loadHighImpactNews(): Promise<ForexNewsEvent[]> {
  const now = Date.now();
  if (newsCache && now - newsCache.at < NEWS_CACHE_MS) return newsCache.events;
  try {
    const { events } = await fetchDailyForexNews();
    const high = events.filter(isHighImpact);
    newsCache = { at: now, events: high };
    return high;
  } catch {
    return newsCache?.events ?? [];
  }
}

/** Block REAL trades ±15 minutes around high-impact news for the pair's currencies. */
export async function findNewsBlock(
  pair: string,
  nowMs = Date.now()
): Promise<{ blocked: boolean; label: string }> {
  const currencies = pairCurrencies(pair);
  if (!currencies.length) return { blocked: false, label: "" };

  const events = await loadHighImpactNews();
  const windowMs = 15 * 60 * 1000;

  for (const event of events) {
    const t = event.timeUtcMs || 0;
    if (!t) continue;
    if (Math.abs(nowMs - t) > windowMs) continue;
    const cur = event.currency.toUpperCase();
    if (!currencies.includes(cur) && cur !== "USD") continue;
    // Always respect USD mega-events; otherwise currency must match pair.
    if (cur === "USD" || currencies.includes(cur)) {
      const mins = Math.round((t - nowMs) / 60000);
      const when =
        mins === 0 ? "now" : mins > 0 ? `in ${mins}m` : `${Math.abs(mins)}m ago`;
      return {
        blocked: true,
        label: `News block · ${event.currency} ${event.event} (${when})`,
      };
    }
  }
  return { blocked: false, label: "" };
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
  return {
    open,
    high,
    low,
    close,
    range,
    body,
    upper,
    lower,
    bullish: close > open,
    bearish: close < open,
    bodyRatio: body / range,
    upperRatio: upper / range,
    lowerRatio: lower / range,
  };
}

/**
 * REAL market gate:
 * EMA50/200 trend filter · RSI14 OB/OS · volume confirmation · news ±15m
 */
export async function applyRealMarketSetup(
  direction: Direction,
  confidence: number,
  candles: MarketCandle[],
  pair: string
): Promise<SetupGateResult> {
  const filters: string[] = [];
  let dir = direction;
  let conf = confidence;

  const ind = computeIndicators(candles);
  if (ind.ema50 != null && ind.ema200 != null) {
    const bullTrend = ind.ema50 > ind.ema200;
    const bearTrend = ind.ema50 < ind.ema200;
    filters.push(
      bullTrend ? "EMA50 > EMA200 · BUY bias only" : bearTrend ? "EMA50 < EMA200 · SELL bias only" : "EMA flat"
    );
    if (bullTrend && dir === "DOWN") {
      dir = "SIDEWAYS";
      conf = Math.min(conf, 48);
      filters.push("Blocked SELL against major uptrend");
    }
    if (bearTrend && dir === "UP") {
      dir = "SIDEWAYS";
      conf = Math.min(conf, 48);
      filters.push("Blocked BUY against major downtrend");
    }
    if (bullTrend && dir === "UP") conf = Math.min(88, conf + 3);
    if (bearTrend && dir === "DOWN") conf = Math.min(88, conf + 3);
  } else {
    filters.push("EMA warming up (need more candles)");
  }

  if (ind.rsi14 != null) {
    filters.push(`RSI14 ${ind.rsi14.toFixed(0)}`);
    if (dir === "UP" && ind.rsi14 > 70) {
      dir = "SIDEWAYS";
      conf = Math.min(conf, 46);
      filters.push("RSI overbought · no BUY");
    }
    if (dir === "DOWN" && ind.rsi14 < 30) {
      dir = "SIDEWAYS";
      conf = Math.min(conf, 46);
      filters.push("RSI oversold · no SELL");
    }
  }

  if (!ind.volumeOk && dir !== "SIDEWAYS") {
    dir = "SIDEWAYS";
    conf = Math.min(conf, 50);
    filters.push("Volume weak vs last 5 · signal skipped");
  } else if (ind.volumeOk && dir !== "SIDEWAYS") {
    filters.push(`Volume OK (×${ind.volumeRatio.toFixed(2)})`);
    conf = Math.min(88, conf + 2);
  }

  const news = await findNewsBlock(pair);
  if (news.blocked) {
    dir = "SIDEWAYS";
    conf = Math.min(conf, 42);
    filters.push(news.label);
  }

  const blocked = dir === "SIDEWAYS" && direction !== "SIDEWAYS";
  return {
    direction: dir,
    confidence: Math.round(conf),
    blocked,
    filters: filters.slice(0, 4),
    note: blocked
      ? "REAL setup filtered · HOLD"
      : dir === "SIDEWAYS"
        ? "REAL · waiting clear setup"
        : "REAL · trend + RSI + volume aligned",
    martingaleHint: "none",
  };
}

/**
 * OTC market gate:
 * S&R rejection · body/wick · momentum follower · 1-step MTG hint
 */
export function applyOtcMarketSetup(
  direction: Direction,
  confidence: number,
  intel: MarketIntelligence | null,
  candles: MarketCandle[]
): SetupGateResult {
  const filters: string[] = [];
  let dir = direction;
  let conf = confidence;

  const last = candles.length ? candleParts(candles[candles.length - 1]) : null;
  const expansion = intel?.otcInsight?.toLowerCase().includes("expansion") ?? false;
  const momentum = intel?.momentum ?? "NEUTRAL";
  const msnr = intel?.msnr;

  // Candle body & wick
  if (last) {
    const marubozu = last.bodyRatio > 0.72 && last.upperRatio < 0.12 && last.lowerRatio < 0.12;
    const longWickReject =
      (last.upperRatio > 0.4 && last.bodyRatio < 0.45) ||
      (last.lowerRatio > 0.4 && last.bodyRatio < 0.45);

    if (marubozu) {
      const cont: Direction = last.bullish ? "UP" : "DOWN";
      filters.push("Large body · continuation");
      if (dir === "SIDEWAYS" || dir === cont) {
        dir = cont;
        conf = Math.max(conf, 68);
      } else {
        // Don't reverse into a strong body candle
        dir = cont;
        conf = Math.max(62, Math.min(conf, 74));
        filters.push("Forced follow body (no early reverse)");
      }
    } else if (longWickReject) {
      filters.push("Long wick rejection");
      const rejectDir: Direction = last.upperRatio > last.lowerRatio ? "DOWN" : "UP";
      // Only take reversal if S&R agrees
      const srOk =
        (rejectDir === "UP" &&
          (msnr?.signal === "SBR" || msnr?.signal === "FRESH_REJECTION" || intel?.priceAction.rejection)) ||
        (rejectDir === "DOWN" &&
          (msnr?.signal === "RBS" || msnr?.signal === "FRESH_REJECTION" || intel?.priceAction.rejection));

      if (srOk) {
        dir = rejectDir;
        conf = Math.min(88, Math.max(conf, 70));
        filters.push(`S&R rejection · ${rejectDir}`);
      } else if (dir !== rejectDir && dir !== "SIDEWAYS") {
        dir = "SIDEWAYS";
        conf = Math.min(conf, 50);
        filters.push("Wick without S&R · skip reverse");
      }
    }
  }

  // Trend momentum follower — OTC streaks
  if (expansion || momentum === "BULLISH" || momentum === "BEARISH") {
    const follow: Direction =
      expansion && intel?.nextCandleDirection !== "SIDEWAYS"
        ? intel!.nextCandleDirection
        : momentum === "BULLISH"
          ? "UP"
          : momentum === "BEARISH"
            ? "DOWN"
            : "SIDEWAYS";

    if (follow !== "SIDEWAYS") {
      filters.push(expansion ? "OTC expansion streak" : `Momentum ${momentum}`);
      if (dir !== "SIDEWAYS" && dir !== follow) {
        dir = "SIDEWAYS";
        conf = Math.min(conf, 48);
        filters.push("No early reverse vs OTC streak");
      } else if (dir === "SIDEWAYS" || dir === follow) {
        dir = follow;
        conf = Math.max(conf, expansion ? 72 : 64);
      }
    }
  }

  // S&R validation for pure reversals
  if (
    intel?.priceAction.rejection &&
    (msnr?.signal === "SBR" || msnr?.signal === "RBS" || msnr?.signal === "FRESH_REJECTION")
  ) {
    const srDir: Direction = msnr.signal === "RBS" ? "DOWN" : msnr.signal === "SBR" ? "UP" : dir;
    if (srDir === "UP" || srDir === "DOWN") {
      if (dir === "SIDEWAYS" || dir === srDir) {
        dir = srDir;
        conf = Math.min(88, Math.max(conf, 71));
        filters.push(`S&R ${msnr.signal}`);
      }
    }
  }

  const blocked = dir === "SIDEWAYS" && direction !== "SIDEWAYS";
  return {
    direction: dir,
    confidence: Math.round(conf),
    blocked,
    filters: filters.slice(0, 4),
    note: blocked
      ? "OTC setup filtered · HOLD"
      : dir === "SIDEWAYS"
        ? "OTC · wait rejection / streak"
        : "OTC · S&R / momentum · 1-step MTG",
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
