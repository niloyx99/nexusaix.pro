import { getPairInfo, quotexPairToDisplay } from "./marketDataClient.js";
import { normalizeKey } from "./licenseStore.js";
import { evaluateBinaryCandleOutcome } from "./binaryCandleOutcome.js";
import { COLLECTIONS, getCollection } from "../db/mongo.js";
import {
  analyticsDayKey,
  findVerificationCandle,
  formatUtc6Time,
  signalAnalyticsDayKey,
} from "./chartCandleLookup.js";
import type { FusedAnalysisResult } from "./fusionAnalysis.js";

const VERIFY_DELAY_MS = 58_000;
const MAX_PENDING_MS = 180_000;

async function listAllChartSignals(): Promise<ChartSignalRecord[]> {
  const col = await getCollection<ChartSignalRecord>(COLLECTIONS.chartSignals);
  return col.find().sort({ signalAt: 1 }).toArray();
}

async function upsertChartSignal(signal: ChartSignalRecord): Promise<void> {
  const col = await getCollection<ChartSignalRecord>(COLLECTIONS.chartSignals);
  await col.updateOne({ id: signal.id }, { $set: signal }, { upsert: true });
}

async function purgeOldAnalyticsDays(): Promise<boolean> {
  const col = await getCollection<ChartSignalRecord>(COLLECTIONS.chartSignals);
  const currentDay = analyticsDayKey();
  const all = await col.find({}, { projection: { id: 1, signalAt: 1 } }).toArray();
  const staleIds = all
    .filter((s) => signalAnalyticsDayKey(s.signalAt) !== currentDay)
    .map((s) => s.id);
  if (!staleIds.length) return false;
  await col.deleteMany({ id: { $in: staleIds } });
  return true;
}

export type ChartSignalDirection = "CALL" | "PUT";
export type ChartSignalStatus = "pending" | "profit" | "loss" | "skipped";

export interface ChartSignalRecord {
  id: string;
  licenseKey: string;
  pair: string;
  displayPair: string;
  direction: ChartSignalDirection;
  recommendation: string;
  confidencePct: number;
  signalAt: string;
  verifyAt: string;
  entryOpen: number;
  entryClose: number;
  entryLastFetch: number | null;
  status: ChartSignalStatus;
  resultOpen?: number;
  resultClose?: number;
  verifiedAt?: string;
}

async function listSignalsForLicense(
  licenseKey: string,
  dayKey: string
): Promise<ChartSignalRecord[]> {
  const col = await getCollection<ChartSignalRecord>(COLLECTIONS.chartSignals);
  const key = normalizeKey(licenseKey);
  const all = await col.find({ licenseKey: key }).sort({ signalAt: -1 }).toArray();
  return all.filter((s) => signalAnalyticsDayKey(s.signalAt) === dayKey);
}

function recommendationToDirection(
  result: FusedAnalysisResult
): ChartSignalDirection | null {
  const rec = result.recommendation;
  if (rec === "STRONG BUY" || rec === "BUY") return "CALL";
  if (rec === "STRONG SELL" || rec === "SELL") return "PUT";

  if (result.nextCandleDirection === "UP") return "CALL";
  if (result.nextCandleDirection === "DOWN") return "PUT";
  return null;
}

export async function recordChartAnalysisSignal(
  licenseKey: string,
  result: FusedAnalysisResult
): Promise<ChartSignalRecord | null> {
  const direction = recommendationToDirection(result);
  if (!direction) return null;

  const pair = result.quotexPair || result.analysisSources?.marketData?.pair || "";
  if (!pair) return null;

  const pairInfo = await getPairInfo(pair);
  if (
    !pairInfo ||
    pairInfo.open === undefined ||
    pairInfo.close === undefined
  ) {
    return null;
  }

  const now = Date.now();
  await purgeOldAnalyticsDays();

  const signal: ChartSignalRecord = {
    id: `chart-${now}-${Math.random().toString(36).slice(2, 8)}`,
    licenseKey: normalizeKey(licenseKey),
    pair: pairInfo.pair,
    displayPair: quotexPairToDisplay(pairInfo.pair),
    direction,
    recommendation: result.recommendation,
    confidencePct: result.fusionConfidencePct ?? result.winRatePct ?? 0,
    signalAt: new Date(now).toISOString(),
    verifyAt: new Date(now + VERIFY_DELAY_MS).toISOString(),
    entryOpen: pairInfo.open,
    entryClose: pairInfo.close,
    entryLastFetch: pairInfo.last_fetch,
    status: "pending",
  };

  await upsertChartSignal(signal);
  return signal;
}

async function verifySignal(signal: ChartSignalRecord): Promise<ChartSignalRecord> {
  const waitedMs = Date.now() - new Date(signal.signalAt).getTime();
  if (waitedMs < VERIFY_DELAY_MS) {
    return signal;
  }

  const candle = await findVerificationCandle(signal.pair, signal.signalAt);
  if (!candle) {
    if (waitedMs >= MAX_PENDING_MS) {
      return { ...signal, status: "skipped", verifiedAt: new Date().toISOString() };
    }
    return signal;
  }

  const outcome = evaluateBinaryCandleOutcome(signal.direction, candle);

  return {
    ...signal,
    status: outcome,
    resultOpen: candle.open,
    resultClose: candle.close,
    verifiedAt: new Date().toISOString(),
  };
}

function needsVerification(signal: ChartSignalRecord): boolean {
  if (signal.status === "pending") {
    return Date.now() >= new Date(signal.verifyAt).getTime();
  }
  if (signal.status !== "profit" && signal.status !== "loss") return false;
  if (signal.resultOpen === undefined || signal.resultClose === undefined) return true;

  const sameAsEntry =
    Math.abs(signal.resultOpen - signal.entryOpen) <=
      Math.max(Math.abs(signal.entryOpen) * 0.000001, 0.0000001) &&
    Math.abs(signal.resultClose - signal.entryClose) <=
      Math.max(Math.abs(signal.entryClose) * 0.000001, 0.0000001);

  return sameAsEntry;
}

export async function resolvePendingChartSignals(): Promise<number> {
  await purgeOldAnalyticsDays();
  const signals = await listAllChartSignals();
  let updated = 0;

  for (const signal of signals) {
    if (!needsVerification(signal)) continue;

    const next = await verifySignal(signal);
    if (
      next.status !== signal.status ||
      next.resultOpen !== signal.resultOpen ||
      next.resultClose !== signal.resultClose ||
      next.verifiedAt !== signal.verifiedAt
    ) {
      await upsertChartSignal(next);
      updated += 1;
    }
  }

  return updated;
}

export interface ChartAnalyticsSummary {
  total: number;
  profit: number;
  loss: number;
  pending: number;
  skipped: number;
  accuracyPct: number;
  analyticsDay: string;
  resetsAtLabel: string;
  dailyHistory: Array<{
    date: string;
    label: string;
    total: number;
    profit: number;
    loss: number;
    accuracyPct: number;
    hour?: string;
  }>;
  recent: Array<{
    id: string;
    pair: string;
    direction: ChartSignalDirection;
    status: ChartSignalStatus;
    signalAt: string;
    timeLabel: string;
    verifiedAt?: string;
    confidencePct: number;
  }>;
}

export async function getChartAnalyticsForLicense(
  licenseKey: string
): Promise<ChartAnalyticsSummary> {
  const key = normalizeKey(licenseKey);
  await purgeOldAnalyticsDays();

  const currentDay = analyticsDayKey();
  const signals = await listSignalsForLicense(key, currentDay);

  const countable = signals.filter((s) => s.status !== "skipped");
  const resolved = countable.filter((s) => s.status === "profit" || s.status === "loss");
  const profit = resolved.filter((s) => s.status === "profit").length;
  const loss = resolved.filter((s) => s.status === "loss").length;
  const pending = countable.filter((s) => s.status === "pending").length;
  const skipped = signals.filter((s) => s.status === "skipped").length;
  const total = countable.length;
  const accuracyPct =
    resolved.length > 0 ? Math.round((profit / resolved.length) * 1000) / 10 : 0;

  const byHour = new Map<string, { profit: number; loss: number }>();
  for (const signal of resolved) {
    const hour = formatUtc6Time(signal.signalAt).slice(0, 2) + ":00";
    const bucket = byHour.get(hour) ?? { profit: 0, loss: 0 };
    if (signal.status === "profit") bucket.profit += 1;
    if (signal.status === "loss") bucket.loss += 1;
    byHour.set(hour, bucket);
  }

  const sortedHours = [...byHour.keys()].sort();
  const dailyHistory =
    sortedHours.length > 0
      ? sortedHours.map((hour) => {
          const bucket = byHour.get(hour)!;
          const dayTotal = bucket.profit + bucket.loss;
          const acc =
            dayTotal > 0
              ? Math.round((bucket.profit / dayTotal) * 1000) / 10
              : 0;
          return {
            date: currentDay,
            label: `${acc}%`,
            total: dayTotal,
            profit: bucket.profit,
            loss: bucket.loss,
            accuracyPct: acc,
            hour,
          };
        })
      : [
          {
            date: currentDay,
            label: total > 0 ? `${accuracyPct}%` : "—",
            total: resolved.length,
            profit,
            loss,
            accuracyPct,
          },
        ];

  const recent = [...signals]
    .sort((a, b) => b.signalAt.localeCompare(a.signalAt))
    .slice(0, 20)
    .map((s) => ({
      id: s.id,
      pair: s.displayPair,
      direction: s.direction,
      status: s.status,
      signalAt: s.signalAt,
      timeLabel: formatUtc6Time(s.signalAt),
      verifiedAt: s.verifiedAt,
      confidencePct: s.confidencePct,
    }));

  return {
    total,
    profit,
    loss,
    pending,
    skipped,
    accuracyPct,
    analyticsDay: currentDay,
    resetsAtLabel: "02:00 AM (UTC+6)",
    dailyHistory,
    recent,
  };
}

/** @deprecated use evaluateBinaryCandleOutcome */
export function evaluateChartSignalOutcome(
  direction: ChartSignalDirection,
  _entryClose: number,
  result: { open: number; high: number; low: number; close: number }
): "profit" | "loss" {
  return evaluateBinaryCandleOutcome(direction, result);
}

export function startChartAnalyticsResolver(intervalMs = 10_000): () => void {
  const tick = () => {
    void resolvePendingChartSignals();
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
