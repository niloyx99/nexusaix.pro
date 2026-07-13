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

const MARKET_API_URL = (
  process.env.QUOTEX_MARKET_API_URL || "https://quotex-data-1n2b.onrender.com"
).replace(/\/$/, "");

const USE_LEGACY_PATHS = process.env.QUOTEX_MARKET_LEGACY === "true";

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
  open: number;
  high: number;
  low: number;
  close: number;
  candle_count: number;
  last_fetch: number | null;
  last_error: string | null;
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

function rowToPairInfo(row: MarketSnapshotRow): MarketPairInfo {
  return {
    pair: row.pair,
    payout: row.payout,
    candle_count: row.candle_count,
    last_fetch: row.last_fetch,
    last_error: row.last_error,
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
  const rows = await fetchJson<MarketSnapshotRow[]>("/api/markets/latest", 1, 7000);
  if (rows?.length) {
    return ingestSnapshotRows(rows);
  }
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
  }>(USE_LEGACY_PATHS ? "/health" : "/api/health", 2, 6000);

  if (!health || health.status !== "ok") {
    const offline = { status: "offline" as const, url: MARKET_API_URL };
    cachedHealth = { at: Date.now(), value: offline };
    return offline;
  }

  if (!cachedPairs.length || Date.now() - cachedPairsAt > PAIRS_CACHE_MS) {
    const snapshots = await refreshMarketSnapshots();
    if (!snapshots.length) {
      const offline = { status: "offline" as const, url: MARKET_API_URL };
      cachedHealth = { at: Date.now(), value: offline };
      return offline;
    }
  }

  const value = {
    status: "ok" as const,
    url: MARKET_API_URL,
    total_pairs: health.total_pairs ?? cachedPairs.length,
    active_pairs: health.total_pairs ?? cachedPairs.length,
    last_update: health.last_update,
  };
  cachedHealth = { at: Date.now(), value };
  return value;
}

/** Instant readiness check using polling cache (no network if warm). */
export function isMarketDataReady(): boolean {
  return Boolean(
    cachedHealth?.value.status === "ok" &&
      Date.now() - (cachedHealth?.at ?? 0) < HEALTH_CACHE_MS * 2 &&
      cachedPairs.length > 0
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
  return fetchJson<MarketCandlesResponse>(
    `/last?pair=${encodeURIComponent(pair)}&n=${limit}&timestamp=1`,
    1,
    6000
  );
}

/** Historical M1 candles from Quotex feed (works for OTC + REAL). */
export async function fetchQuotexHistoricalCandles(
  pair: string,
  limit = 120
): Promise<MarketCandle[]> {
  const data = await fetchLegacyCandles(pair, limit);
  return data?.candles ?? [];
}

/**
 * Fast path for chart analysis: use in-memory candles first.
 * Only hit remote history when local cache is too thin.
 */
export async function getRecentCandles(
  pair: string,
  limit = 30
): Promise<MarketCandlesResponse | null> {
  if (USE_LEGACY_PATHS) {
    return fetchLegacyCandles(pair, limit);
  }

  const info = await getPairInfo(pair);
  if (!info) return null;

  let candles = getCachedCandles(pair, limit);

  if (candles.length < Math.min(8, limit)) {
    await refreshMarketSnapshots();
    candles = getCachedCandles(pair, limit);
  }

  // Prefer cache; only fetch remote when critically thin (keeps analyze fast).
  if (candles.length < Math.min(12, limit)) {
    const historical = await fetchQuotexHistoricalCandles(pair, Math.min(Math.max(limit, 40), 100));
    if (historical.length) {
      candles = mergeCandlesByTimestamp(historical, candles);
    }
  }

  if (!candles.length && info.open !== undefined) {
    const ts = info.last_fetch ?? Math.floor(Date.now() / 1000);
    candles = [
      {
        open: info.open,
        high: info.high ?? info.open,
        low: info.low ?? info.open,
        close: info.close ?? info.open,
        timestamp: ts,
        date_time: new Date(ts * 1000).toISOString(),
        tick_volume: 0,
      },
    ];
  }

  if (!candles.length) return null;

  return {
    pair: info.pair,
    payout: info.payout,
    count: candles.length,
    candles,
  };
}

export async function getAllPairs(): Promise<MarketPairInfo[]> {
  if (USE_LEGACY_PATHS) {
    const rows = await fetchJson<MarketPairInfo[]>("/pairs", 1, 7000);
    return (rows ?? []).filter((row) => isAllowedMarketPair(row.pair));
  }

  if (cachedPairs.length && Date.now() - cachedPairsAt < PAIRS_CACHE_MS) {
    return cachedPairs;
  }

  const latest = await fetchJson<MarketSnapshotRow[]>("/api/markets/latest", 1, 7000);
  if (latest?.length) {
    return ingestSnapshotRows(latest);
  }

  if (cachedPairs.length) return cachedPairs;

  const [otc, real] = await Promise.all([
    fetchJson<MarketSnapshotRow[]>("/api/markets/otc", 1, 7000),
    fetchJson<MarketSnapshotRow[]>("/api/markets/real", 1, 7000),
  ]);

  if (otc?.length || real?.length) {
    const allowed = ingestSnapshotRows([...(otc ?? []), ...(real ?? [])]);
    cachedPairs = allowed;
    cachedPairsAt = Date.now();
    return allowed;
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
