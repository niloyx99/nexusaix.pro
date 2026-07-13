import {
  getPairInfo,
  getRecentCandles,
  refreshMarketSnapshots,
  quotexPairToDisplay,
} from "./marketDataClient.js";
import { getCachedCandles } from "./marketSnapshotCache.js";
import { evaluateBinaryCandleOutcome } from "./binaryCandleOutcome.js";
import { isAllowedMarketPair } from "../config/allowedMarkets.js";
import {
  fetchYahooM1Candles,
  mergeCandlesByTimestamp,
} from "./yahooForexCandles.js";
import type { MarketCandle } from "./marketDataClient.js";

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

function normalizePairToken(raw: string): string {
  return raw.trim().toUpperCase().replace(/\//g, "").replace(/\s+/g, "");
}

function resolveQuotexPair(token: string, preferOtc = false): string | null {
  const upper = normalizePairToken(token);
  if (!upper) return null;

  const candidates = preferOtc
    ? [upper.endsWith("_OTC") ? upper : `${upper}_OTC`, upper.replace(/_OTC$/, "")]
    : [upper.replace(/_OTC$/, ""), `${upper}_OTC`];

  for (const c of candidates) {
    if (isAllowedMarketPair(c)) return c;
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
  const time = match[2].padStart(5, "0");
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
  const dateKey = parseDateFromText(text);
  const lines = text.split(/\r?\n/);
  const parsed: ParsedFutureSignal[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const row = parseSignalFromLine(line);
    if (!row) continue;

    const dedupeKey = `${row.quotexPair}|${row.time}|${row.direction}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    parsed.push({ ...row, dateKey });
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
  const [hh, mm] = timePart.split(":").map(Number);
  const base = new Date(`${datePart}T00:00:00Z`);
  base.setUTCHours(hh, mm + minutes, 0, 0);
  const nh = String(base.getUTCHours()).padStart(2, "0");
  const nm = String(base.getUTCMinutes()).padStart(2, "0");
  return `${datePart}T${nh}:${nm}`;
}

function findCandleForKey(
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
  const targetTs = Date.UTC(y, m - 1, d, hh - UTC_OFFSET_HOURS, mm, 0);

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

async function loadCandlesForPair(pair: string): Promise<MarketCandle[]> {
  await refreshMarketSnapshots();
  const data = await getRecentCandles(pair, 120);
  const cached = data?.candles ?? getCachedCandles(pair, 120);

  const yahoo = await fetchYahooM1Candles(pair);
  // Quotex cache wins over Yahoo when both have the same minute.
  let candles = mergeCandlesByTimestamp(yahoo, cached);

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
  await Promise.all(
    pairs.map(async (pair) => {
      cache.set(pair, await loadCandlesForPair(pair));
    })
  );
  return cache;
}

async function checkOneSignal(
  signal: ParsedFutureSignal,
  candleCache: Map<string, MarketCandle[]>
): Promise<Omit<CheckedSignal, "geminiConfirmed" | "geminiNote">> {
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

  const candles = candleCache.get(signal.quotexPair) ?? [];

  const candle1 = findCandleForKey(candles, signal.dateKey, signal.time);
  const key2 = addMinutesToKey(utc6KeyFromParts(signal.dateKey, signal.time), 1);
  const [, time2] = key2.split("T");
  const candle2 = findCandleForKey(candles, signal.dateKey, time2);

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
    return {
      ...signal,
      outcome: "unknown",
      line,
      marker: outcomeMarker("unknown"),
      candle1Found: true,
      candle2Found: false,
    };
  }

  const mtgDir = signal.direction;
  const mtg = evaluateCandle(mtgDir, candle2);
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

async function confirmWithGemini(
  results: Omit<CheckedSignal, "geminiConfirmed" | "geminiNote">[]
): Promise<Map<string, { outcome: CheckerOutcome; note: string }>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const map = new Map<string, { outcome: CheckerOutcome; note: string }>();
  if (!apiKey) return map;

  const verifiable = results.filter(
    (r) => r.outcome !== "unknown" && r.outcome !== "pending"
  );
  if (!verifiable.length) return map;

  const model = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";
  const payload = verifiable.map((r) => ({
    id: `${r.pair}-${r.time}`,
    pair: r.quotexPair,
    timeUtc6: r.time,
    direction: r.direction,
    engineOutcome: r.outcome,
    candle1Found: r.candle1Found,
    candle2Found: r.candle2Found,
  }));

  const prompt = `You validate 1-minute Quotex binary signal results (UTC+6).
Rules:
- profit = first candle wins: CALL if close > open, PUT if close < open
- mtg_profit = first candle lost, same direction wins on next candle (1-step MTG)
- mtg_loss = first and MTG candle both lost
- Only exact flat candle (close equals open) counts as profit

Return ONLY JSON:
{"results":[{"id":"PAIR-12:10","outcome":"profit|mtg_profit|mtg_loss","note":"short"}]}

Signals:
${JSON.stringify(payload, null, 2)}`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:7777",
        "X-Title": "Aldi Bot Signal Checker",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 1200,
        temperature: 0.05,
      }),
    });

    if (!response.ok) return map;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return map;

    const parsed = JSON.parse(
      content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    ) as {
      results?: Array<{ id: string; outcome: CheckerOutcome; note?: string }>;
    };

    for (const row of parsed.results ?? []) {
      if (!row.id || !row.outcome) continue;
      map.set(row.id, { outcome: row.outcome, note: row.note ?? "Gemini confirmed" });
    }
  } catch {
    return map;
  }

  return map;
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

  await refreshMarketSnapshots();
  const candleCache = await preloadCandleCache(parsed);
  const preliminary: Omit<CheckedSignal, "geminiConfirmed" | "geminiNote">[] = [];
  for (const signal of parsed) {
    preliminary.push(await checkOneSignal(signal, candleCache));
  }
  const geminiMap = await confirmWithGemini(preliminary);

  const results: CheckedSignal[] = preliminary.map((row) => {
    const id = `${row.pair}-${row.time}`;
    const g = geminiMap.get(id);
    const outcome =
      row.outcome === "unknown" && g?.outcome ? g.outcome : row.outcome;
    const geminiConfirmed =
      !!g && (g.outcome === row.outcome || row.outcome === "unknown");
    return {
      ...row,
      outcome,
      geminiConfirmed,
      geminiNote: g?.note ?? "",
      marker: outcomeMarker(outcome),
    };
  });

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
