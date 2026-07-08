import type { MarketCandle } from "./marketDataClient.js";
import { isOtcPair } from "../config/allowedMarkets.js";

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

export function quotexPairToYahooSymbol(pair: string): string | null {
  const base = pair.toUpperCase().replace(/_OTC$/i, "");
  if (isOtcPair(pair)) return null;
  if (base === "XAUUSD") return "XAUUSD=X";
  if (base === "XAGUSD") return "XAGUSD=X";
  if (/^[A-Z]{6}$/.test(base)) return `${base}=X`;
  if (/^[A-Z]{3,7}USD$/.test(base)) return `${base}=X`;
  return null;
}

function toMarketCandle(
  ts: number,
  open: number,
  high: number,
  low: number,
  close: number
): MarketCandle {
  return {
    open,
    high,
    low,
    close,
    timestamp: ts,
    date_time: new Date(ts * 1000).toISOString(),
    tick_volume: 0,
  };
}

export async function fetchYahooM1Candles(pair: string): Promise<MarketCandle[]> {
  const symbol = quotexPairToYahooSymbol(pair);
  if (!symbol) return [];

  try {
    const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return [];

    const data = (await response.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
            }>;
          };
        }>;
      };
    };

    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    if (!quote || !timestamps.length) return [];

    const candles: MarketCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      if (
        ts == null ||
        open == null ||
        high == null ||
        low == null ||
        close == null
      ) {
        continue;
      }
      candles.push(toMarketCandle(ts, open, high, low, close));
    }
    return candles;
  } catch {
    return [];
  }
}

export function mergeCandlesByTimestamp(
  ...lists: MarketCandle[][]
): MarketCandle[] {
  const map = new Map<number, MarketCandle>();
  for (const list of lists) {
    for (const c of list) {
      if (!c.timestamp) continue;
      map.set(c.timestamp, c);
    }
  }
  return [...map.values()].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}
