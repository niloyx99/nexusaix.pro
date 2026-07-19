import {
  getPairInfo,
  getRecentCandles,
  refreshMarketSnapshots,
  quotexPairToDisplay,
} from "../market/marketDataClient.js";
import { getCachedCandles } from "../market/marketSnapshotCache.js";
import { evaluateBinaryCandleOutcome } from "./binaryCandleOutcome.js";
import { isAllowedMarketPair, isOtcPair } from "../config/allowedMarkets.js";
import {
  fetchYahooM1Candles,
  mergeCandlesByTimestamp,
} from "../market/yahooForexCandles.js";
import type { MarketCandle } from "../market/marketDataClient.js";

/** Enough M1 bars for overnight / multi-hour signal lists. */
const CHECKER_CANDLE_LIMIT = 180;

export type SignalDirection = "CALL" | "PUT";
export type CheckerOutcome =
  | "profit"
  | "mtg_profit"
  | "mtg_loss"
  | "pending"
  | "unknown";

export interface ParsedFutureSignal {
  pair: string;
  quotexPair: string;
  displayPair: string;
  time: string;
  direction: SignalDirection;
  dateKey: string;
}

export interface CheckedSignal extends ParsedFutureSignal {
  outcome: CheckerOutcome;
  geminiConfirmed: boolean;
  geminiNote: string;
  line: string;
  marker: string;
  candle1Found: boolean;
  candle2Found: boolean;
}

const UTC_OFFSET_HOURS = 6;

function parseDateFromText(text: string): string {
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) {
    const now = new Date(Date.now() + UTC_OFFSET_HOURS * 3600 * 1000);
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(dt.getUTCDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}

function hhmmToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

function normalizeHhmm(raw: string): string {
  const [hPart, mPart] = raw.trim().split(":");
  const hh = String(Number(hPart)).padStart(2, "0");
  const mm = String(Number(mPart)).padStart(2, "0");
  return `${hh}:${mm}`;
}

function normalizePairToken(raw: string): string {
  return raw.trim().toUpperCase().replace(/\//g, "").replace(/\s+/g, "");
}

/** Canonical Quotex pair id — OTC suffix always `_otc` for VPS API. */
function canonicalizeQuotexPair(pair: string): string {
  const upper = pair.toUpperCase();
  if (upper.endsWith("_OTC")) {
    return `${upper.slice(0, -4)}_otc`;
  }
  return upper;
}

function resolveQuotexPair(token: string, preferOtc = false): string | null {
  const upper = normalizePairToken(token);
  if (!upper) return null;

  const candidates = preferOtc
    ? [upper.endsWith("_OTC") ? upper : `${upper}_OTC`, upper.replace(/_OTC$/, "")]
    : [upper.replace(/_OTC$/, ""), `${upper}_OTC`];

  for (const c of candidates) {
    if (isAllowedMarketPair(c)) return canonicalizeQuotexPair(c);
  }
  return null;
}

function stripSignalLineNoise(line: string): string {
  return line
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, "")
    .replace(/[✅❌❓⏳⌛•·|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDirection(raw: string): SignalDirection | null {
  const upper = raw.trim().toUpperCase();
  if (upper === "CALL" || upper === "BUY") return "CALL";
  if (upper === "PUT" || upper === "SELL") return "PUT";
  return null;
}

/** Extract M1;PAIR;HH:MM;CALL|PUT from a line (tolerates emojis, markers, extra text). */
function parseSignalFromLine(line: string): Omit<ParsedFutureSignal, "dateKey"> | null {
  const cleaned = stripSignalLineNoise(line);
  if (!cleaned) return null;

  const match = cleaned.match(
    /M1\s*;\s*([A-Za-z0-9/_]+(?:\s*\(OTC\))?)\s*;\s*(\d{1,2}:\d{2})\s*;\s*(CALL|PUT|BUY|SELL)\b/i
  );
  if (!match) return null;

  const pairToken = match[1].replace(/\s*\(OTC\)/gi, "").trim();
  const time = normalizeHhmm(match[2]);
  const direction = normalizeDirection(match[3]);
  if (!direction) return null;

  const preferOtc = /\(OTC\)/i.test(match[1]) || line.toUpperCase().includes("OTC");
  const quotexPair = resolveQuotexPair(pairToken, preferOtc);
  if (!quotexPair) return null;

  return {
    pair: normalizePairToken(pairToken),
    quotexPair,
    displayPair: quotexPairToDisplay(quotexPair),
    time,
    direction,
  };
}

export function parseFutureSignalText(text: string): ParsedFutureSignal[] {
  const baseDateKey = parseDateFromText(text);
  const lines = text.split(/\r?\n/);
  const parsed: ParsedFutureSignal[] = [];
  const seen = new Set<string>();

  // Midnight rollover: 23:59 → 00:03 means next calendar day (UTC+6)
  let currentDateKey = baseDateKey;
  let lastMinutes: number | null = null;

  for (const line of lines) {
    const row = parseSignalFromLine(line);
    if (!row) continue;

    const minutes = hhmmToMinutes(row.time);
    if (lastMinutes !== null && minutes + 90 < lastMinutes) {
      // Time jumped backwards by >1.5h → crossed midnight
      currentDateKey = addDaysToDateKey(currentDateKey, 1);
    }
    lastMinutes = minutes;

    const dedupeKey = `${row.quotexPair}|${currentDateKey}|${row.time}|${row.direction}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    parsed.push({ ...row, dateKey: currentDateKey });
  }

  return parsed;
}

function utc6KeyFromParts(dateKey: string, hhmm: string): string {
  const [hh, mm] = hhmm.split(":");
  return `${dateKey}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function candleUtc6Key(candle: MarketCandle): string | null {
  const ts = candle.timestamp;
  if (!ts) return null;
  const utc6 = new Date(ts * 1000 + UTC_OFFSET_HOURS * 3600 * 1000);
  const y = utc6.getUTCFullYear();
  const m = String(utc6.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc6.getUTCDate()).padStart(2, "0");
  const hh = String(utc6.getUTCHours()).padStart(2, "0");
  const mm = String(utc6.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function addMinutesToKey(key: string, minutes: number): string {
  const [datePart, timePart] = key.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
  base.setUTCMinutes(base.getUTCMinutes() + minutes);
  const ny = base.getUTCFullYear();
  const nm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(base.getUTCDate()).padStart(2, "0");
  const nh = String(base.getUTCHours()).padStart(2, "0");
  const nmin = String(base.getUTCMinutes()).padStart(2, "0");
  return `${ny}-${nm}-${nd}T${nh}:${nmin}`;
}

function findCandleExact(
  candles: MarketCandle[],
  dateKey: string,
  hhmm: string
): MarketCandle | null {
  const key = utc6KeyFromParts(dateKey, hhmm);
  for (const c of candles) {
    if (candleUtc6Key(c) === key) return c;
  }

  const want = normalizeHhmm(hhmm);
  for (const c of candles) {
    const k = candleUtc6Key(c);
    if (k?.endsWith(`T${want}`) && k.startsWith(dateKey)) {
      return c;
    }
  }

  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = want.split(":").map(Number);
  const targetTs = Date.UTC(y, m - 1, d, hh - UTC_OFFSET_HOURS, mm, 0);

  let best: MarketCandle | null = null;
  let bestDiff = Infinity;
  for (const c of candles) {
    if (!c.timestamp) continue;
    const diff = Math.abs(c.timestamp * 1000 - targetTs);
    // Wider window (3 min) — VPS candles can be slightly skewed
    if (diff < bestDiff && diff <= 180_000) {
      bestDiff = diff;
      best = c;
    }
  }
  return best;
}

function findCandleForKey(
  candles: MarketCandle[],
  dateKey: string,
  hhmm: string
): MarketCandle | null {
  const exact = findCandleExact(candles, dateKey, hhmm);
  if (exact) return exact;

  // Midnight / wrong-header fallback: try adjacent UTC+6 days
  const nextDay = findCandleExact(candles, addDaysToDateKey(dateKey, 1), hhmm);
  if (nextDay) return nextDay;
  const prevDay = findCandleExact(candles, addDaysToDateKey(dateKey, -1), hhmm);
  if (prevDay) return prevDay;

  return null;
}

/** Quotex M1 rule: CALL wins on green (close > open), PUT on red (close < open). */
function evaluateCandle(
  direction: SignalDirection,
  candle: MarketCandle
): "profit" | "loss" {
  return evaluateBinaryCandleOutcome(direction, candle);
}

function nowUtc6Key(): string {
  const now = new Date(Date.now() + UTC_OFFSET_HOURS * 3600 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function signalUtc6Key(signal: ParsedFutureSignal): string {
  return utc6KeyFromParts(signal.dateKey, signal.time);
}

/** Signal candle not closed yet, or MTG candle still forming. */
function isSignalPending(signal: ParsedFutureSignal): boolean {
  const signalKey = signalUtc6Key(signal);
  const nowKey = nowUtc6Key();
  if (signal.dateKey !== nowKey.split("T")[0]) {
    return false;
  }
  const mtgKey = addMinutesToKey(signalKey, 2);
  return nowKey < mtgKey;
}

function outcomeMarker(outcome: CheckerOutcome): string {
  if (outcome === "profit" || outcome === "mtg_profit") return "✅";
  if (outcome === "mtg_loss") return "❌ •";
  if (outcome === "pending") return "⏳";
  return "❓";
}

function formatSignalLine(signal: ParsedFutureSignal): string {
  return `M1;${signal.pair.replace(/_OTC$/i, "")};${signal.time};${signal.direction}`;
}

/**
 * Fast candle load for checker:
 * - Always refresh from VPS (local cache alone often misses overnight bars)
 * - Yahoo only as REAL-market fallback when Quotex is empty
 */
async function loadCandlesForPair(pair: string): Promise<MarketCandle[]> {
  const localCached = getCachedCandles(pair, CHECKER_CANDLE_LIMIT);
  const data = await getRecentCandles(pair, CHECKER_CANDLE_LIMIT);
  let candles = mergeCandlesByTimestamp(localCached, data?.candles ?? []);

  // Yahoo only for REAL pairs when Quotex has almost nothing
  if (!isOtcPair(pair) && candles.length < 5) {
    const yahoo = await fetchYahooM1Candles(pair);
    candles = mergeCandlesByTimestamp(yahoo, candles);
  }

  if (!candles.length) {
    const info = await getPairInfo(pair);
    if (info?.open !== undefined && info.close !== undefined) {
      const ts = info.last_fetch ?? Math.floor(Date.now() / 1000);
      candles = [
        {
          open: info.open,
          high: info.high ?? info.open,
          low: info.low ?? info.open,
          close: info.close,
          timestamp: ts,
          date_time: new Date(ts * 1000).toISOString(),
        },
      ];
    }
  }
  return candles;
}

async function preloadCandleCache(
  signals: ParsedFutureSignal[]
): Promise<Map<string, MarketCandle[]>> {
  const pairs = [...new Set(signals.map((s) => s.quotexPair))];
  const cache = new Map<string, MarketCandle[]>();
  // Bound concurrency so VPS is not flooded (still much faster than sequential)
  const CONCURRENCY = 4;
  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (pair) => {
        cache.set(pair, await loadCandlesForPair(pair));
      })
    );
  }
  return cache;
}

function evaluateSignalAgainstCandles(
  signal: ParsedFutureSignal,
  candles: MarketCandle[]
): Omit<CheckedSignal, "geminiConfirmed" | "geminiNote"> {
  const line = formatSignalLine(signal);

  if (isSignalPending(signal)) {
    return {
      ...signal,
      outcome: "pending",
      line,
      marker: outcomeMarker("pending"),
      candle1Found: false,
      candle2Found: false,
    };
  }

  const candle1 = findCandleForKey(candles, signal.dateKey, signal.time);
  // MTG minute must follow the *actual* candle day (handles midnight header mismatch)
  const candle1Key =
    (candle1 && candleUtc6Key(candle1)) ||
    utc6KeyFromParts(signal.dateKey, signal.time);
  const key2 = addMinutesToKey(candle1Key, 1);
  const [date2, time2] = key2.split("T");
  const candle2 = findCandleForKey(candles, date2, time2);

  if (!candle1) {
    return {
      ...signal,
      outcome: "unknown",
      line,
      marker: outcomeMarker("unknown"),
      candle1Found: false,
      candle2Found: !!candle2,
    };
  }

  const first = evaluateCandle(signal.direction, candle1);
  if (first === "profit") {
    return {
      ...signal,
      outcome: "profit",
      line,
      marker: outcomeMarker("profit"),
      candle1Found: true,
      candle2Found: !!candle2,
    };
  }

  if (!candle2) {
    const nowKey = nowUtc6Key();
    if (nowKey < addMinutesToKey(key2, 1)) {
      return {
        ...signal,
        outcome: "pending",
        line,
        marker: outcomeMarker("pending"),
        candle1Found: true,
        candle2Found: false,
      };
    }
    return {
      ...signal,
      outcome: "unknown",
      line,
      marker: outcomeMarker("unknown"),
      candle1Found: true,
      candle2Found: false,
    };
  }

  const mtg = evaluateCandle(signal.direction, candle2);
  if (mtg === "profit") {
    return {
      ...signal,
      outcome: "mtg_profit",
      line,
      marker: outcomeMarker("mtg_profit"),
      candle1Found: true,
      candle2Found: true,
    };
  }

  return {
    ...signal,
    outcome: "mtg_loss",
    line,
    marker: outcomeMarker("mtg_loss"),
    candle1Found: true,
    candle2Found: true,
  };
}

export interface SignalCheckSummary {
  total: number;
  profit: number;
  mtgProfit: number;
  mtgLoss: number;
  pending: number;
  unknown: number;
  accuracyPct: number;
  dateKey: string;
  results: CheckedSignal[];
  formatted: string;
}

export async function checkFutureSignalsText(text: string): Promise<SignalCheckSummary> {
  const parsed = parseFutureSignalText(text);
  if (!parsed.length) {
    return {
      total: 0,
      profit: 0,
      mtgProfit: 0,
      mtgLoss: 0,
      pending: 0,
      unknown: 0,
      accuracyPct: 0,
      dateKey: parseDateFromText(text),
      results: [],
      formatted: "No valid M1 signals found. Use format: M1;EURUSD;12:10;CALL (emojis/markers OK)",
    };
  }

  // Always refresh snapshots so overnight candles are available
  await refreshMarketSnapshots();
  const candleCache = await preloadCandleCache(parsed);

  // Pure candle math — no Gemini (was the main delay; outcomes are deterministic)
  let preliminary = parsed.map((signal) =>
    evaluateSignalAgainstCandles(signal, candleCache.get(signal.quotexPair) ?? [])
  );

  // One shared reload for pairs that still miss the primary candle
  const missingPairs = [
    ...new Set(
      preliminary
        .filter((r) => r.outcome === "unknown" && !r.candle1Found)
        .map((r) => r.quotexPair)
    ),
  ];
  if (missingPairs.length) {
    await Promise.all(
      missingPairs.map(async (pair) => {
        candleCache.set(pair, await loadCandlesForPair(pair));
      })
    );
    preliminary = parsed.map((signal) =>
      evaluateSignalAgainstCandles(signal, candleCache.get(signal.quotexPair) ?? [])
    );
  }

  const results: CheckedSignal[] = preliminary.map((row) => ({
    ...row,
    geminiConfirmed: false,
    geminiNote: "",
    marker: outcomeMarker(row.outcome),
  }));

  const profit = results.filter((r) => r.outcome === "profit").length;
  const mtgProfit = results.filter((r) => r.outcome === "mtg_profit").length;
  const mtgLoss = results.filter((r) => r.outcome === "mtg_loss").length;
  const pending = results.filter((r) => r.outcome === "pending").length;
  const unknown = results.filter((r) => r.outcome === "unknown").length;
  const wins = profit + mtgProfit;
  const resolved = results.length - unknown - pending;
  const accuracyPct = resolved > 0 ? Math.round((wins / resolved) * 1000) / 10 : 0;

  const dateKey = parsed[0]?.dateKey ?? parseDateFromText(text);
  const [y, m, d] = dateKey.split("-");
  const displayDate = `${d}/${m}/${y}`;

  let formatted = `🗓𝗗𝗔𝗧𝗘 -${displayDate}\n`;
  formatted += `⏰𝗧𝗜𝗠𝗘 𝗭𝗢𝗡𝗘 - ( 𝗨𝗧𝗖 +𝟲:𝟬𝟬 )\n`;
  formatted += `📊𝟭 𝗠𝗜𝗡𝗨𝗧𝗘 𝗦𝗜𝗚𝗡𝗔𝗟𝗦\n`;
  formatted += `⭐️𝟭 𝗦𝗧𝗘𝗣 𝗠𝗧𝗚 𝗜𝗙 𝗡𝗘𝗘𝗗\n\n`;
  formatted += `╔══☠️ ALDI FX OFFICIAL ☠️══╗\n`;
  formatted += `📈 CHECK: ${wins}W / ${mtgLoss}L / ${pending}⏳ / ${unknown}? · ACC ${accuracyPct}%\n\n`;

  for (const row of results) {
    const mtgTag = row.outcome === "mtg_profit" ? " (MTG)" : "";
    formatted += `${row.line}  ${row.marker}${mtgTag}\n`;
  }

  formatted += `\n╚══☠️ ALDI FX OFFICIAL  ☠️ ══╝`;

  return {
    total: results.length,
    profit,
    mtgProfit,
    mtgLoss,
    pending,
    unknown,
    accuracyPct,
    dateKey,
    results,
    formatted,
  };
}
