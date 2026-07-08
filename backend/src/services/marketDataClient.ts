import {
  ALLOWED_REAL_PAIRS,
  isAllowedMarketPair,
  isOtcPair,
} from "../config/allowedMarkets.js";
import {
  getCachedCandles,
  upsertSnapshotCandle,
} from "./marketSnapshotCache.js";

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

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${MARKET_API_URL}${path}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

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

  return allowed;
}

export async function refreshMarketSnapshots(): Promise<MarketPairInfo[]> {
  const rows = await fetchJson<MarketSnapshotRow[]>("/api/markets/latest");
  if (rows?.length) {
    return ingestSnapshotRows(rows);
  }
  return [];
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

export async function checkMarketDataHealth(): Promise<{
  status: "ok" | "offline";
  url: string;
  total_pairs?: number;
  active_pairs?: number;
  last_update?: string;
}> {
  const health = await fetchJson<{
    status: string;
    total_pairs?: number;
    last_update?: string;
  }>(USE_LEGACY_PATHS ? "/health" : "/api/health");

  if (!health || health.status !== "ok") {
    return { status: "offline", url: MARKET_API_URL };
  }

  await refreshMarketSnapshots();

  return {
    status: "ok",
    url: MARKET_API_URL,
    total_pairs: health.total_pairs,
    active_pairs: health.total_pairs,
    last_update: health.last_update,
  };
}

export async function getPairInfo(pair: string): Promise<MarketPairInfo | null> {
  const pairs = await getAllPairs();
  return pairs.find((row) => row.pair.toUpperCase() === pair.toUpperCase()) ?? null;
}

async function fetchLegacyCandles(
  pair: string,
  limit: number
): Promise<MarketCandlesResponse | null> {
  return fetchJson<MarketCandlesResponse>(
    `/last?pair=${encodeURIComponent(pair)}&n=${limit}&timestamp=1`
  );
}

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

  if (candles.length < limit) {
    await refreshMarketSnapshots();
    candles = getCachedCandles(pair, limit);
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
    const rows = await fetchJson<MarketPairInfo[]>("/pairs");
    return (rows ?? []).filter((row) => isAllowedMarketPair(row.pair));
  }

  const latest = await fetchJson<MarketSnapshotRow[]>("/api/markets/latest");
  if (latest?.length) {
    return ingestSnapshotRows(latest);
  }

  const [otc, real] = await Promise.all([
    fetchJson<MarketSnapshotRow[]>("/api/markets/otc"),
    fetchJson<MarketSnapshotRow[]>("/api/markets/real"),
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

export function startMarketDataPolling(intervalMs = 60_000): () => void {
  void refreshMarketSnapshots();
  const timer = setInterval(() => {
    void refreshMarketSnapshots();
  }, intervalMs);
  return () => clearInterval(timer);
}
