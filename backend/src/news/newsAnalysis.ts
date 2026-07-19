import type { ForexNewsEvent } from "./forexNewsClient.js";
import { parseForexNewsTimeUtcMs } from "./forexNewsClient.js";
import {
  loadNewsAnalysisDoc,
  loadNewsAnalysesForDate,
  saveNewsAnalysisDoc,
  type AnalysisPhase,
} from "./newsAnalysisStore.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

const CONFIRMATION_BEFORE_MS = 30 * 60 * 1000;
export const ANALYSIS_VERSION = 4;
const SCHEDULER_MIN_GAP_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  analyzedAt: number;
  snapshot: string;
  phase: AnalysisPhase;
  data: NewsAnalysisResult;
}

const analysisCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<NewsAnalysisResult>>();
let lastSchedulerRunMs = 0;
let cacheHydrated = false;
export interface NewsAnalysisResult {
  status: "ok" | "fallback";
  eventId: string;
  summary: string;
  surprise: "beat" | "miss" | "inline" | "pending" | "unknown";
  currencyBias: "bullish" | "bearish" | "neutral";
  primaryPair: string;
  affectedPairs: string[];
  tradingBias: "CALL" | "PUT" | "AVOID" | "WAIT";
  confidencePct: number;
  directionReason: string;
  analysisText: string;
  keyTakeaways: string[];
}

function openRouterReferer(): string {
  const raw = process.env.FRONTEND_URL || "http://localhost:8889";
  return raw.split(",")[0].trim().replace(/\/$/, "") || "http://localhost:8889";
}

function getApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY || null;
}

export function cacheKey(event: ForexNewsEvent): string {
  return `v${ANALYSIS_VERSION}:${event.calendarDate}:${event.id}`;
}

function eventSnapshot(event: ForexNewsEvent): string {
  return `${event.actual}|${event.forecast}|${event.previous}|${event.time}`;
}

export function eventTimeMs(event: ForexNewsEvent): number | null {
  return parseForexNewsTimeUtcMs(event.time);
}

function endOfUtc6DayMs(calendarDate: string): number {
  const [y, m, d] = calendarDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 18, 0, 0);
}

function detectAnalysisPhase(event: ForexNewsEvent, now = Date.now()): AnalysisPhase {
  const hasActual = event.actual !== "n/a" && event.actual.length > 0;
  if (hasActual) return "post-release";

  const eventMs = eventTimeMs(event);
  if (eventMs && now >= eventMs - CONFIRMATION_BEFORE_MS && now < eventMs) {
    return "confirmation";
  }

  return "initial";
}

export function getCachedAnalysis(event: ForexNewsEvent): CacheEntry | undefined {
  const entry = analysisCache.get(cacheKey(event));
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    analysisCache.delete(cacheKey(event));
    return undefined;
  }
  return entry;
}

function docToCacheEntry(doc: Awaited<ReturnType<typeof loadNewsAnalysisDoc>>): CacheEntry | null {
  if (!doc || doc.expiresAt <= Date.now()) return null;
  return {
    expiresAt: doc.expiresAt,
    analyzedAt: doc.analyzedAt,
    snapshot: doc.snapshot,
    phase: doc.phase,
    data: doc.data,
  };
}

/** Load today's analyses from MongoDB into memory (survives server restarts). */
export async function hydrateNewsAnalysisCache(calendarDate: string): Promise<number> {
  const docs = await loadNewsAnalysesForDate(calendarDate, ANALYSIS_VERSION);
  let loaded = 0;
  for (const doc of docs) {
    const entry = docToCacheEntry(doc);
    if (!entry) continue;
    analysisCache.set(doc._id, entry);
    loaded++;
  }
  cacheHydrated = true;
  return loaded;
}

export function isNewsCacheHydrated(): boolean {
  return cacheHydrated;
}

export function canRunNewsScheduler(): boolean {
  const now = Date.now();
  if (now - lastSchedulerRunMs < SCHEDULER_MIN_GAP_MS) return false;
  lastSchedulerRunMs = now;
  return true;
}

export function markNewsSchedulerRun(): void {
  lastSchedulerRunMs = Date.now();
}
export function shouldRefreshAnalysis(
  event: ForexNewsEvent,
  cached?: CacheEntry
): boolean {
  if (!cached) return true;

  const snapshot = eventSnapshot(event);
  if (cached.snapshot !== snapshot) return true;

  const hasActual = event.actual !== "n/a" && event.actual.length > 0;
  if (cached.data.surprise === "pending" && hasActual) return true;

  const eventMs = eventTimeMs(event);
  if (!eventMs) return false;

  const now = Date.now();
  const confirmationStart = eventMs - CONFIRMATION_BEFORE_MS;

  if (now >= confirmationStart && now < eventMs && cached.phase !== "confirmation") {
    return true;
  }

  return false;
}

function defaultPrimaryPair(currency: string): string {
  const map: Record<string, string> = {
    USD: "EURUSD",
    EUR: "EURUSD",
    GBP: "GBPUSD",
    JPY: "USDJPY",
    CAD: "USDCAD",
    AUD: "AUDUSD",
    NZD: "NZDUSD",
    CHF: "USDCHF",
  };
  return map[currency] ?? `USD${currency}`;
}

function pairHints(currency: string): string[] {
  const primary = defaultPrimaryPair(currency);
  if (currency === "USD") return ["EURUSD", "GBPUSD", "USDJPY"];
  if (currency === "EUR") return ["EURUSD", "EURGBP", "EURJPY"];
  if (currency === "GBP") return ["GBPUSD", "EURGBP", "GBPJPY"];
  if (currency === "JPY") return ["USDJPY", "EURJPY", "GBPJPY"];
  if (currency === "CAD") return ["USDCAD", "CADJPY", "EURCAD"];
  return [primary, `${currency} pairs`];
}

function inferPreEventDirection(event: ForexNewsEvent): {
  tradingBias: "CALL" | "PUT";
  currencyBias: "bullish" | "bearish" | "neutral";
  directionReason: string;
} {
  const name = event.event.toLowerCase();
  const inverseMetrics =
    name.includes("unemployment") ||
    name.includes("jobless") ||
    name.includes("claims");

  const parseNum = (raw: string): number | null => {
    if (!raw || raw === "n/a") return null;
    const cleaned = raw.replace(/,/g, "").replace(/%/g, "").replace(/[kmb]/gi, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const forecast = parseNum(event.forecast);
  const previous = parseNum(event.previous);

  if (forecast !== null && previous !== null) {
    const better = forecast > previous;
    const bullish = inverseMetrics ? !better : better;
    return {
      tradingBias: bullish ? "CALL" : "PUT",
      currencyBias: bullish ? "bullish" : "bearish",
      directionReason: `Forecast (${event.forecast}) vs Previous (${event.previous}) suggests ${bullish ? "stronger" : "weaker"} ${event.currency}.`,
    };
  }

  return {
    tradingBias: "CALL",
    currencyBias: "neutral",
    directionReason: `Pre-release bias on ${defaultPrimaryPair(event.currency)} from ${event.currency} high-impact event.`,
  };
}

function fallbackAnalysis(event: ForexNewsEvent): NewsAnalysisResult {
  const hasActual = event.actual !== "n/a" && event.actual.length > 0;
  const primaryPair = defaultPrimaryPair(event.currency);
  const pre = inferPreEventDirection(event);

  let surprise: NewsAnalysisResult["surprise"] = "unknown";
  if (!hasActual) surprise = "pending";

  let tradingBias: NewsAnalysisResult["tradingBias"] = pre.tradingBias;
  let currencyBias = pre.currencyBias;
  let directionReason = pre.directionReason;

  if (hasActual && event.forecast !== "n/a") {
    directionReason = `Actual ${event.actual} vs Forecast ${event.forecast} — trade the post-release move on ${primaryPair}.`;
  }

  return {
    status: "fallback",
    eventId: event.id,
    summary: `${primaryPair} · ${tradingBias === "CALL" ? "BUY" : "SELL"} · ${event.event}`,
    surprise,
    currencyBias,
    primaryPair,
    affectedPairs: pairHints(event.currency),
    tradingBias,
    confidencePct: hasActual ? 58 : 62,
    directionReason,
    analysisText: [
      `### Market`,
      `- **Pair:** ${primaryPair}`,
      `- **Direction:** ${tradingBias === "CALL" ? "BUY (CALL)" : "SELL (PUT)"}`,
      `- **Event:** ${event.event} (${event.currency})`,
      "",
      `### Data`,
      `- **Actual:** ${event.actual}`,
      `- **Forecast:** ${event.forecast}`,
      `- **Previous:** ${event.previous}`,
      "",
      `### Plan`,
      directionReason,
    ].join("\n"),
    keyTakeaways: [
      `Trade ${primaryPair} — ${tradingBias === "CALL" ? "BUY" : "SELL"} on 1-min after release.`,
      "Enter 1–2 minutes after the candle opens post-news.",
      "Avoid entries 30 seconds before release.",
    ],
  };
}

function storeCache(event: ForexNewsEvent, data: NewsAnalysisResult): NewsAnalysisResult {
  const now = Date.now();
  const phase = detectAnalysisPhase(event, now);
  const dayEnd = endOfUtc6DayMs(event.calendarDate);
  const key = cacheKey(event);
  const expiresAt = dayEnd > now ? dayEnd : now + 3600_000;

  const entry: CacheEntry = {
    expiresAt,
    analyzedAt: now,
    snapshot: eventSnapshot(event),
    phase,
    data,
  };

  analysisCache.set(key, entry);

  void saveNewsAnalysisDoc({
    _id: key,
    calendarDate: event.calendarDate,
    eventId: event.id,
    analysisVersion: ANALYSIS_VERSION,
    snapshot: entry.snapshot,
    phase: entry.phase,
    analyzedAt: entry.analyzedAt,
    expiresAt: entry.expiresAt,
    data: entry.data,
    updatedAt: new Date().toISOString(),
  });

  return data;
}
export async function analyzeNewsEvent(
  event: ForexNewsEvent,
  options: { force?: boolean } = {}
): Promise<NewsAnalysisResult> {
  const key = cacheKey(event);

  let cached = getCachedAnalysis(event);
  if (!cached) {
    const doc = await loadNewsAnalysisDoc(key);
    const fromDb = docToCacheEntry(doc);
    if (fromDb) {
      analysisCache.set(key, fromDb);
      cached = fromDb;
    }
  }

  if (!options.force && cached && !shouldRefreshAnalysis(event, cached)) {
    return cached.data;
  }

  const running = inFlight.get(key);
  if (running) return running;

  const job = runGeminiAnalysis(event).finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

async function runGeminiAnalysis(event: ForexNewsEvent): Promise<NewsAnalysisResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return storeCache(event, fallbackAnalysis(event));
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const hasActual = event.actual !== "n/a";
  const phase = detectAnalysisPhase(event);
  const phaseNote =
    phase === "confirmation"
      ? "CONFIRMATION PASS: News releases in ~30 minutes. Re-confirm CALL/PUT direction with highest confidence."
      : phase === "post-release"
        ? "POST-RELEASE: Actual data is available. Analyze surprise vs forecast."
        : "INITIAL DAILY PASS: Predict direction from Forecast vs Previous before release.";

  const prompt = `You are Nexus AI — elite forex news analyst for 1-minute binary options (Quotex).

${phaseNote}

Analyze this HIGH-IMPACT economic calendar event. Timezone: UTC+6.

Event:
${JSON.stringify(event, null, 2)}

CRITICAL RULES:
1. primaryPair: ONE best pair to trade on Quotex (e.g. CAD news → USDCAD, USD news → EURUSD or USDJPY)
2. tradingBias: MUST be CALL (buy/up) or PUT (sell/down) — pick a clear direction
3. Even BEFORE release (Actual=n/a): predict direction from Forecast vs Previous
4. Unemployment/claims: higher = bearish for currency (inverse logic)
5. Employment/GDP/retail: higher than previous = bullish for currency
6. directionReason: one clear sentence — why BUY or SELL on primaryPair
7. Do NOT return WAIT unless event has zero forecast AND zero previous data
8. affectedPairs: 2-3 pairs, primaryPair must be first
9. analysisText: markdown — ### Market, ### Direction, ### Data, ### Entry Plan (short, readable)
10. keyTakeaways: 3 bullets max

Return ONLY JSON:
{
  "summary": "USDCAD BUY — Employment Change bearish CAD",
  "surprise": "beat|miss|inline|pending|unknown",
  "currencyBias": "bullish|bearish|neutral",
  "primaryPair": "USDCAD",
  "affectedPairs": ["USDCAD", "CADJPY"],
  "tradingBias": "CALL|PUT",
  "confidencePct": 75,
  "directionReason": "Forecast well below previous — CAD likely weak, BUY USDCAD",
  "analysisText": "markdown...",
  "keyTakeaways": ["..."]
}`;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": openRouterReferer(),
        "X-Title": "Nexus AI News",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 1600,
        temperature: 0.12,
      }),
      signal: AbortSignal.timeout(40_000),
    });

    if (!response.ok) {
      return storeCache(event, fallbackAnalysis(event));
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return storeCache(event, fallbackAnalysis(event));
    }

    const parsed = JSON.parse(
      content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    ) as Omit<NewsAnalysisResult, "status" | "eventId">;

    const result: NewsAnalysisResult = {
      status: "ok",
      eventId: event.id,
      summary: parsed.summary || `${event.currency} — ${event.event}`,
      surprise: parsed.surprise || (hasActual ? "unknown" : "pending"),
      currencyBias: parsed.currencyBias || "neutral",
      primaryPair: parsed.primaryPair || defaultPrimaryPair(event.currency),
      affectedPairs: parsed.affectedPairs?.length ? parsed.affectedPairs : pairHints(event.currency),
      tradingBias:
        parsed.tradingBias === "CALL" || parsed.tradingBias === "PUT"
          ? parsed.tradingBias
          : inferPreEventDirection(event).tradingBias,
      confidencePct: Math.min(99, Math.max(0, Number(parsed.confidencePct) || 60)),
      directionReason:
        parsed.directionReason ||
        `Trade ${parsed.primaryPair || defaultPrimaryPair(event.currency)} based on ${event.event}.`,
      analysisText: parsed.analysisText || "",
      keyTakeaways: parsed.keyTakeaways?.length
        ? parsed.keyTakeaways
        : ["Review Forecast vs Previous before entry."],
    };

    return storeCache(event, result);
  } catch {
    return storeCache(event, fallbackAnalysis(event));
  }
}
