import {
  ALLOWED_REAL_PAIRS,
  isAllowedMarketPair,
  isOtcPair,
} from "../config/allowedMarkets.js";
import {
  getCachedCandles,
  upsertSnapshotCandle,
} from "./marketSnapshotCache.js";
import { mergeCandlesByTimestamp } from "./yahooForexCandles.js";

/** VPS Quotex candle API — /health /pairs /last?pair=&n= */
const MARKET_API_URL = (
  process.env.QUOTEX_MARKET_API_URL || "http://161.248.189.73:1339"
).replace(/\/$/, "");

/** Prefer VPS-style /health /pairs /last — set QUOTEX_MARKET_LEGACY=false for /api/markets/*. */
const USE_LEGACY_PATHS = process.env.QUOTEX_MARKET_LEGACY !== "false";

export interface MarketCandle {
  date_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tick_volume?: number;
  timestamp?: number;
}

export interface MarketPairInfo {
  pair: string;
  payout: number;
  candle_count: number;
  last_fetch: number | null;
  last_error: string | null;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

export interface MarketCandlesResponse {
  pair: string;
  payout: number;
  count: number;
  candles: MarketCandle[];
}

interface MarketSnapshotRow {
  pair: string;
  payout: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  candle_count: number;
  last_fetch?: number | null;
  last_error?: string | null;
  latest_time?: string;
}

interface RawLegacyCandle {
  timestamp?: number;
  date?: string;
  time?: string;
  date_time?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  tick_volume?: number;
  payout?: number;
}

const DISPLAY_NAMES: Record<string, string> = {
  ATOUSD: "Avalanche",
  AVAUSD: "Avalanche",
  BNBUSD: "Binance Coin",
  BTCUSD: "Bitcoin",
  DASUSD: "Dash",
  DOTUSD: "Polkadot",
  ETCUSD: "Ethereum Classic",
  XRPUSD: "Ripple",
  TONUSD: "Toncoin",
  ZECUSD: "Zcash",
  TRUUSD: "Trump",
  LTCUSD: "Litecoin",
  SOLUSD: "Solana",
  BCHUSD: "Bitcoin Cash",
  ETHUSD: "Ethereum",
  LINUSD: "Chainlink",
  AXSUSD: "Axie Infinity",
  USCRUDE: "USCrude",
  UKBRENT: "UKBrent",
  XAGUSD: "Silver",
  XAUUSD: "Gold",
  AXP: "American Express",
  BA: "Boeing",
  FB: "Meta",
  INTC: "Intel",
  JNJ: "Johnson & Johnson",
  MCD: "McDonald's",
  MSFT: "Microsoft",
  PFE: "Pfizer",
  AXJAUD: "Australia 200",
  F40EUR: "France 40",
  FTSGBP: "UK 100",
  HSIHKD: "Hong Kong 50",
  IBXEUR: "Spain 35",
  JPXJPY: "Japan 225",
  STXEUR: "Euro Stoxx 50",
};

const TITLE_TO_PAIR: Record<string, string> = {
  AVALANCHE: "ATOUSD",
  BINANCECOIN: "BNBUSD",
  BITCOIN: "BTCUSD",
  DASH: "DASUSD",
  POLKADOT: "DOTUSD",
  ETHEREUMCLASSIC: "ETCUSD",
  RIPPLE: "XRPUSD",
  TONCOIN: "TONUSD",
  ZCASH: "ZECUSD",
  TRUMP: "TRUUSD",
  LITECOIN: "LTCUSD",
  SOLANA: "SOLUSD",
  BITCOINCASH: "BCHUSD",
  ETHEREUM: "ETHUSD",
  CHAINLINK: "LINUSD",
  AXIINFINITY: "AXSUSD",
  AXIEINFINITY: "AXSUSD",
  USCRUDE: "USCRUDE",
  UKBRENT: "UKBRENT",
  SILVER: "XAGUSD",
  GOLD: "XAUUSD",
  AMERICANEXPRESS: "AXP",
  BOEING: "BA",
  META: "FB",
  FACEBOOK: "FB",
  INTEL: "INTC",
  JOHNSONJOHNSON: "JNJ",
  MCDONALDS: "MCD",
  MICROSOFT: "MSFT",
  PFIZER: "PFE",
};

async function fetchJson<T>(path: string, attempts = 1, timeoutMs = 8000): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${MARKET_API_URL}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        if (attempt < attempts - 1) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        return null;
      }
      return (await response.json()) as T;
    } catch {
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

let cachedHealth: {
  at: number;
  value: {
    status: "ok" | "offline";
    url: string;
    total_pairs?: number;
    active_pairs?: number;
    last_update?: string;
  };
} | null = null;

const HEALTH_CACHE_MS = 25_000;
let cachedPairs: MarketPairInfo[] = [];
let cachedPairsAt = 0;
const PAIRS_CACHE_MS = 20_000;

function normalizeCandle(raw: RawLegacyCandle): MarketCandle | null {
  const open = Number(raw.open);
  const high = Number(raw.high);
  const low = Number(raw.low);
  const close = Number(raw.close);
  if (![open, high, low, close].every(Number.isFinite)) return null;

  let timestamp = Number(raw.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    const date = String(raw.date || "").trim();
    const time = String(raw.time || "").trim();
    const parsed = Date.parse(date && time ? `${date}T${time}Z` : String(raw.date_time || ""));
    timestamp = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
  }

  // Guard absurd future timestamps from bad clocks
  const nowSec = Math.floor(Date.now() / 1000);
  if (timestamp > nowSec + 86400 * 365) {
    const date = String(raw.date || "").trim();
    const time = String(raw.time || "").trim();
    const parsed = Date.parse(date && time ? `${date}T${time}Z` : "");
    if (Number.isFinite(parsed)) timestamp = Math.floor(parsed / 1000);
  }

  return {
    open,
    high,
    low,
    close,
    tick_volume: Number(raw.tick_volume) || 0,
    timestamp,
    date_time: new Date(timestamp * 1000).toISOString(),
  };
}

function rowToPairInfo(row: MarketSnapshotRow): MarketPairInfo {
  let lastFetch = row.last_fetch ?? null;
  if (lastFetch == null && row.latest_time) {
    const parsed = Date.parse(row.latest_time.replace(" ", "T") + "Z");
    if (Number.isFinite(parsed)) lastFetch = Math.floor(parsed / 1000);
  }
  return {
    pair: row.pair,
    payout: row.payout,
    candle_count: row.candle_count,
    last_fetch: lastFetch,
    last_error: row.last_error ?? null,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
  };
}

function ingestSnapshotRows(rows: MarketSnapshotRow[]): MarketPairInfo[] {
  const allowed = rows
    .filter((row) => isAllowedMarketPair(row.pair))
    .map(rowToPairInfo);

  for (const row of allowed) {
    if (
      row.open !== undefined &&
      row.high !== undefined &&
      row.low !== undefined &&
      row.close !== undefined
    ) {
      upsertSnapshotCandle(row.pair, {
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        last_fetch: row.last_fetch,
      });
    }
  }

  if (allowed.length) {
    cachedPairs = allowed;
    cachedPairsAt = Date.now();
  }

  return allowed;
}

export async function refreshMarketSnapshots(): Promise<MarketPairInfo[]> {
  if (USE_LEGACY_PATHS) {
    const rows = await fetchJson<MarketSnapshotRow[]>("/pairs", 2, 12000);
    if (rows?.length) return ingestSnapshotRows(rows);
    return cachedPairs;
  }

  const rows = await fetchJson<MarketSnapshotRow[]>("/api/markets/latest", 1, 12000);
  if (rows?.length) return ingestSnapshotRows(rows);
  return cachedPairs;
}

export function titleToQuotexPair(
  title: string,
  marketType: "REAL" | "OTC"
): string {
  const cleaned = title
    .replace(/\s*\(OTC\)/gi, "")
    .replace(/\s*\(REAL\)/gi, "")
    .trim();

  const normalized = cleaned
    .replace(/\//g, "")
    .replace(/\s/g, "")
    .replace(/-/g, "")
    .toUpperCase();

  if (!normalized) return "";

  const mapped = TITLE_TO_PAIR[normalized] ?? normalized;

  if (marketType === "OTC") {
    if (mapped.endsWith("_OTC")) return mapped;
    return `${mapped}_otc`;
  }

  return mapped.replace(/_OTC$/i, "");
}

export async function checkMarketDataHealth(options?: {
  force?: boolean;
}): Promise<{
  status: "ok" | "offline";
  url: string;
  total_pairs?: number;
  active_pairs?: number;
  last_update?: string;
}> {
  if (
    !options?.force &&
    cachedHealth &&
    Date.now() - cachedHealth.at < HEALTH_CACHE_MS
  ) {
    return cachedHealth.value;
  }

  const health = await fetchJson<{
    status: string;
    total_pairs?: number;
    last_update?: string;
    latest_candle_time?: string;
  }>(USE_LEGACY_PATHS ? "/health" : "/api/health", 3, 15000);

  if (!health || health.status !== "ok") {
    const offline = { status: "offline" as const, url: MARKET_API_URL };
    cachedHealth = { at: Date.now(), value: offline };
    return offline;
  }

  if (!cachedPairs.length || Date.now() - cachedPairsAt > PAIRS_CACHE_MS) {
    const snapshots = await refreshMarketSnapshots();
    if (!snapshots.length) {
      // Still mark ok if /health is ok — probe one candle as fallback
      const probe = await fetchLegacyCandles("EURUSD_otc", 3);
      if (!probe?.candles?.length) {
        const offline = { status: "offline" as const, url: MARKET_API_URL };
        cachedHealth = { at: Date.now(), value: offline };
        return offline;
      }
    }
  }

  const value = {
    status: "ok" as const,
    url: MARKET_API_URL,
    total_pairs: health.total_pairs ?? cachedPairs.length,
    active_pairs: health.total_pairs ?? cachedPairs.length,
    last_update: health.last_update || health.latest_candle_time,
  };
  cachedHealth = { at: Date.now(), value };
  return value;
}

export function isMarketDataReady(): boolean {
  return Boolean(
    cachedHealth?.value.status === "ok" &&
      Date.now() - (cachedHealth?.at ?? 0) < HEALTH_CACHE_MS * 2
  );
}

export async function getPairInfo(pair: string): Promise<MarketPairInfo | null> {
  if (cachedPairs.length && Date.now() - cachedPairsAt < PAIRS_CACHE_MS) {
    const hit =
      cachedPairs.find((row) => row.pair.toUpperCase() === pair.toUpperCase()) ?? null;
    if (hit) return hit;
  }
  const pairs = await getAllPairs();
  return pairs.find((row) => row.pair.toUpperCase() === pair.toUpperCase()) ?? null;
}

async function fetchLegacyCandles(
  pair: string,
  limit: number
): Promise<MarketCandlesResponse | null> {
  if (!isAllowedMarketPair(pair)) return null;

  const raw = await fetchJson<{
    pair?: string;
    payout?: number;
    count?: number;
    candles?: RawLegacyCandle[];
  }>(`/last?pair=${encodeURIComponent(pair)}&n=${limit}&timestamp=1`, 2, 12000);

  if (!raw?.candles?.length) return null;

  const candles = raw.candles
    .map(normalizeCandle)
    .filter((c): c is MarketCandle => c !== null)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  if (!candles.length) return null;

  const last = candles[candles.length - 1];
  upsertSnapshotCandle(pair, {
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    last_fetch: last.timestamp ?? Math.floor(Date.now() / 1000),
  });

  return {
    pair: raw.pair || pair,
    payout: Number(raw.payout) || Number(raw.candles[0]?.payout) || 0,
    count: candles.length,
    candles,
  };
}

export async function fetchQuotexHistoricalCandles(
  pair: string,
  limit = 120
): Promise<MarketCandle[]> {
  const data = await fetchLegacyCandles(pair, limit);
  return data?.candles ?? [];
}

export async function getRecentCandles(
  pair: string,
  limit = 30
): Promise<MarketCandlesResponse | null> {
  // VPS /last is the primary source — allow up to 180 for overnight signal checks
  const remote = await fetchLegacyCandles(pair, Math.min(Math.max(limit, 40), 180));
  if (remote?.candles?.length) {
    const info = {
      pair: remote.pair,
      payout: remote.payout,
      candle_count: remote.count,
      last_fetch: remote.candles[remote.candles.length - 1]?.timestamp ?? null,
      last_error: null as string | null,
      open: remote.candles[remote.candles.length - 1]?.open,
      high: remote.candles[remote.candles.length - 1]?.high,
      low: remote.candles[remote.candles.length - 1]?.low,
      close: remote.candles[remote.candles.length - 1]?.close,
    };
    const idx = cachedPairs.findIndex(
      (row) => row.pair.toUpperCase() === pair.toUpperCase()
    );
    if (idx >= 0) cachedPairs[idx] = info;
    else cachedPairs.push(info);
    cachedPairsAt = Date.now();

    return {
      pair: remote.pair,
      payout: remote.payout,
      count: remote.candles.length,
      candles: remote.candles.slice(-limit),
    };
  }

  const cached = getCachedCandles(pair, limit);
  if (!cached.length) return null;

  const info = await getPairInfo(pair);
  return {
    pair,
    payout: info?.payout || 0,
    count: cached.length,
    candles: cached,
  };
}

export async function getAllPairs(): Promise<MarketPairInfo[]> {
  if (cachedPairs.length && Date.now() - cachedPairsAt < PAIRS_CACHE_MS) {
    return cachedPairs;
  }

  if (USE_LEGACY_PATHS) {
    const rows = await fetchJson<MarketSnapshotRow[]>("/pairs", 2, 12000);
    if (rows?.length) return ingestSnapshotRows(rows);
    return cachedPairs;
  }

  const latest = await fetchJson<MarketSnapshotRow[]>("/api/markets/latest", 1, 12000);
  if (latest?.length) return ingestSnapshotRows(latest);

  if (cachedPairs.length) return cachedPairs;

  const [otc, real] = await Promise.all([
    fetchJson<MarketSnapshotRow[]>("/api/markets/otc", 1, 12000),
    fetchJson<MarketSnapshotRow[]>("/api/markets/real", 1, 12000),
  ]);

  if (otc?.length || real?.length) {
    return ingestSnapshotRows([...(otc ?? []), ...(real ?? [])]);
  }

  return [];
}

export function quotexPairToDisplay(pair: string): string {
  const upper = pair.toUpperCase();
  const isOtc = isOtcPair(pair);
  const base = upper.replace(/_OTC$/, "");

  if (DISPLAY_NAMES[base]) {
    return `${DISPLAY_NAMES[base]}${isOtc ? " (OTC)" : ""}`;
  }

  if (base.length === 6) {
    return `${base.slice(0, 3)}/${base.slice(3)}${isOtc ? " (OTC)" : ""}`;
  }

  if (base.length === 7 && base.endsWith("USD")) {
    return `${base.slice(0, 3)}/${base.slice(3)}${isOtc ? " (OTC)" : ""}`;
  }

  return pair;
}

export const REAL_MARKET_PAIRS = [...ALLOWED_REAL_PAIRS];

export function getMarketApiUrl(): string {
  return MARKET_API_URL;
}

export function startMarketDataPolling(intervalMs = 30_000): () => void {
  void checkMarketDataHealth({ force: true });
  const timer = setInterval(() => {
    void checkMarketDataHealth({ force: true });
  }, intervalMs);
  return () => clearInterval(timer);
}
