import type { MarketCandle } from "./marketDataClient.js";
import { getCachedCandles } from "./marketSnapshotCache.js";
import { getRecentCandles, refreshMarketSnapshots } from "./marketDataClient.js";
import {
  fetchYahooM1Candles,
  mergeCandlesByTimestamp,
} from "./yahooForexCandles.js";

export const ANALYTICS_UTC_OFFSET_HOURS = 6;
export const ANALYTICS_DAY_RESET_HOUR = 2;

export function analyticsDayKey(date = new Date()): string {
  const utc6 = new Date(
    date.getTime() + ANALYTICS_UTC_OFFSET_HOURS * 3600 * 1000
  );
  let y = utc6.getUTCFullYear();
  let m = utc6.getUTCMonth();
  let d = utc6.getUTCDate();
  const hh = utc6.getUTCHours();

  if (hh < ANALYTICS_DAY_RESET_HOUR) {
    const prev = new Date(Date.UTC(y, m, d) - 24 * 3600 * 1000);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth();
    d = prev.getUTCDate();
  }

  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function signalAnalyticsDayKey(signalAtIso: string): string {
  return analyticsDayKey(new Date(signalAtIso));
}

function utc6KeyFromParts(dateKey: string, hhmm: string): string {
  const [hh, mm] = hhmm.split(":");
  return `${dateKey}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function candleUtc6Key(candle: MarketCandle): string | null {
  const ts = candle.timestamp;
  if (!ts) return null;
  const utc6 = new Date(ts * 1000 + ANALYTICS_UTC_OFFSET_HOURS * 3600 * 1000);
  const y = utc6.getUTCFullYear();
  const m = String(utc6.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc6.getUTCDate()).padStart(2, "0");
  const hh = String(utc6.getUTCHours()).padStart(2, "0");
  const mm = String(utc6.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function verificationMinuteForSignal(signalAtIso: string): {
  dateKey: string;
  hhmm: string;
} {
  const signalAt = new Date(signalAtIso);
  const utc6 = new Date(
    signalAt.getTime() + ANALYTICS_UTC_OFFSET_HOURS * 3600 * 1000 + 60_000
  );
  const y = utc6.getUTCFullYear();
  const m = String(utc6.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc6.getUTCDate()).padStart(2, "0");
  const hh = String(utc6.getUTCHours()).padStart(2, "0");
  const mm = String(utc6.getUTCMinutes()).padStart(2, "0");
  return { dateKey: `${y}-${m}-${d}`, hhmm: `${hh}:${mm}` };
}

export function findCandleForMinute(
  candles: MarketCandle[],
  dateKey: string,
  hhmm: string
): MarketCandle | null {
  const key = utc6KeyFromParts(dateKey, hhmm);
  for (const c of candles) {
    if (candleUtc6Key(c) === key) return c;
  }

  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const targetTs = Date.UTC(
    y,
    m - 1,
    d,
    hh - ANALYTICS_UTC_OFFSET_HOURS,
    mm,
    0
  );

  let best: MarketCandle | null = null;
  let bestDiff = Infinity;
  for (const c of candles) {
    if (!c.timestamp) continue;
    const diff = Math.abs(c.timestamp * 1000 - targetTs);
    if (diff < bestDiff && diff <= 90_000) {
      bestDiff = diff;
      best = c;
    }
  }
  return best;
}

export async function loadPairCandles(pair: string): Promise<MarketCandle[]> {
  await refreshMarketSnapshots();
  const data = await getRecentCandles(pair, 120);
  const cached = data?.candles ?? getCachedCandles(pair, 120);
  const yahoo = await fetchYahooM1Candles(pair);
  return mergeCandlesByTimestamp(yahoo, cached);
}

export async function findVerificationCandle(
  pair: string,
  signalAtIso: string
): Promise<MarketCandle | null> {
  const { dateKey, hhmm } = verificationMinuteForSignal(signalAtIso);
  const candles = await loadPairCandles(pair);
  return findCandleForMinute(candles, dateKey, hhmm);
}

export function formatUtc6Time(iso: string): string {
  const d = new Date(iso);
  const utc6 = new Date(
    d.getTime() + ANALYTICS_UTC_OFFSET_HOURS * 3600 * 1000
  );
  const hh = String(utc6.getUTCHours()).padStart(2, "0");
  const mm = String(utc6.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
