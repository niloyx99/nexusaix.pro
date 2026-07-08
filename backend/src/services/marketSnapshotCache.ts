import type { MarketCandle } from "./marketDataClient.js";
import { COLLECTIONS, getCollection } from "../db/mongo.js";

interface CachedSeries {
  candles: MarketCandle[];
}

interface CandleHistoryDoc {
  pair: string;
  candles: MarketCandle[];
}

const seriesByPair = new Map<string, CachedSeries>();
const MAX_CANDLES = 180;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;

function pairKey(pair: string): string {
  return pair.toUpperCase();
}

function floorToMinute(ts: number): number {
  return Math.floor(ts / 60) * 60;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const col = await getCollection<CandleHistoryDoc>(COLLECTIONS.candleHistory);
    const docs = await col.find().toArray();
    for (const doc of docs) {
      if (doc.candles?.length) {
        seriesByPair.set(doc.pair, {
          candles: doc.candles.slice(-MAX_CANDLES),
        });
      }
    }
  } catch {
    // Mongo not ready yet
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistToMongo();
  }, 2000);
}

async function persistToMongo(): Promise<void> {
  await ensureLoaded();
  const col = await getCollection<CandleHistoryDoc>(COLLECTIONS.candleHistory);
  for (const [key, series] of seriesByPair.entries()) {
    const candles = series.candles.slice(-MAX_CANDLES);
    await col.updateOne(
      { pair: key },
      { $set: { pair: key, candles } },
      { upsert: true }
    );
  }
}

export function upsertSnapshotCandle(
  pair: string,
  snapshot: {
    open: number;
    high: number;
    low: number;
    close: number;
    last_fetch: number | null;
  }
): void {
  void ensureLoaded();
  const key = pairKey(pair);
  const timestamp = floorToMinute(snapshot.last_fetch ?? Math.floor(Date.now() / 1000));
  const date_time = new Date(timestamp * 1000).toISOString();

  const candle: MarketCandle = {
    open: snapshot.open,
    high: snapshot.high,
    low: snapshot.low,
    close: snapshot.close,
    timestamp,
    date_time,
    tick_volume: 0,
  };

  const current = seriesByPair.get(key) ?? { candles: [] };
  const last = current.candles[current.candles.length - 1];

  if (last?.timestamp === timestamp) {
    current.candles[current.candles.length - 1] = candle;
  } else {
    current.candles.push(candle);
  }

  if (current.candles.length > MAX_CANDLES) {
    current.candles = current.candles.slice(-MAX_CANDLES);
  }

  seriesByPair.set(key, current);
  schedulePersist();
}

export function getCachedCandles(pair: string, limit = 60): MarketCandle[] {
  const current = seriesByPair.get(pairKey(pair));
  if (!current?.candles.length) return [];
  return current.candles.slice(-limit);
}

export function clearMarketSnapshotCache(): void {
  seriesByPair.clear();
}

export async function loadMarketSnapshotCache(): Promise<void> {
  await ensureLoaded();
}
