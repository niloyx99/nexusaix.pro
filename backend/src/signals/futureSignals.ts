import {
  checkMarketDataHealth,
  getAllPairs,
  getRecentCandles,
  quotexPairToDisplay,
  type MarketPairInfo,
} from "../market/marketDataClient.js";
import { isAllowedMarketPair, isOtcPair } from "../config/allowedMarkets.js";
import { analyzeFuturesSignal } from "./futuresSignalEngine.js";
import {
  confirmSignalsWithGemini,
  type GeminiCandidate,
} from "../analysis/geminiConfirm.js";

export interface FutureSignal {
  id: string;
  time: string;
  pair: string;
  quotexPair: string;
  direction: "CALL" | "PUT";
  duration: "1 Min";
  confidence: number;
  engineScore: number;
  daisyScore: number;
  reasons: string[];
}

export interface GenerateSignalsRequest {
  marketType: "REAL" | "OTC";
  count: 5 | 10 | 15 | 20;
}

export interface GenerateSignalsResult {
  success: boolean;
  marketType: "REAL" | "OTC";
  signals: FutureSignal[];
  scannedPairs: number;
  geminiStatus: "ok" | "fallback";
  message?: string;
}

interface ScoredCandidate {
  quotexPair: string;
  displayPair: string;
  direction: "CALL" | "PUT";
  engineScore: number;
  daisyScore: number;
  confidence: number;
  reasons: string[];
  payout: number;
  currencyBase: string;
}

type ScoreMode = "strict" | "relaxed" | "fill";

const SIGNAL_GAPS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 55];
const UTC_OFFSET_HOURS = 6;

const MIN_PAYOUT_OTC = 70;
const MIN_PAYOUT_REAL = 40;
const MIN_PAYOUT_OTC_RELAXED = 60;
const MIN_PAYOUT_REAL_RELAXED = 30;
const MIN_ENGINE = 62;
const MIN_ENGINE_RELAXED = 52;
const MIN_ENGINE_FILL = 40;
const MIN_CONF = 66;
const MIN_ALIGN = 3;
const MIN_GEMINI_CONFIDENCE = 78;
const ELITE_ENGINE = 72;
const ELITE_CONF = 76;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function extractBaseCurrency(pair: string): string {
  const base = pair.replace(/_otc$/i, "");
  return base.length >= 6 ? base.slice(0, 3) : base;
}

function minPayout(isOtc: boolean, mode: ScoreMode): number {
  if (mode === "fill") return isOtc ? 55 : 25;
  if (mode === "relaxed") return isOtc ? MIN_PAYOUT_OTC_RELAXED : MIN_PAYOUT_REAL_RELAXED;
  return isOtc ? MIN_PAYOUT_OTC : MIN_PAYOUT_REAL;
}

async function scorePair(
  pairInfo: MarketPairInfo,
  isOtc: boolean,
  mode: ScoreMode = "strict"
): Promise<ScoredCandidate | null> {
  if (pairInfo.payout < minPayout(isOtc, mode)) return null;

  const candleData = await getRecentCandles(pairInfo.pair, mode === "fill" ? 40 : 60);
  const candles = candleData?.candles ?? [];
  if (candles.length < (mode === "fill" ? 6 : 10)) return null;

  const analysis = await analyzeFuturesSignal(candles, pairInfo.pair, {
    marketType: isOtc ? "OTC" : "REAL",
  });

  let direction: "CALL" | "PUT" | null = null;
  if (analysis.direction === "UP") direction = "CALL";
  else if (analysis.direction === "DOWN") direction = "PUT";

  // Fill mode: force a direction from momentum / last candle if sideways
  if (!direction && mode === "fill") {
    const mom = analysis.layers.momentum.direction;
    if (mom === "UP") direction = "CALL";
    else if (mom === "DOWN") direction = "PUT";
    else {
      const last = candles[candles.length - 1];
      const prev = candles[candles.length - 2] ?? last;
      direction = Number(last.close) >= Number(prev.close) ? "CALL" : "PUT";
    }
  }

  if (!direction) return null;

  const minAlign = mode === "strict" ? MIN_ALIGN : mode === "relaxed" ? 2 : 1;
  if (analysis.alignedCount < minAlign && mode !== "fill") return null;

  const minEngine =
    mode === "strict"
      ? MIN_ENGINE
      : mode === "relaxed"
        ? MIN_ENGINE_RELAXED
        : MIN_ENGINE_FILL;
  if (analysis.engineScore < minEngine && mode !== "fill") return null;

  const payoutBoost =
    pairInfo.payout >= 90 ? 4 : pairInfo.payout >= 80 ? 2 : 0;

  const confidence = clamp(
    (mode === "fill" ? Math.max(analysis.confidence, 58) : analysis.confidence) +
      payoutBoost,
    mode === "fill" ? 58 : MIN_CONF - 6,
    94
  );

  const reasons = [
    ...analysis.reasons,
    `Payout ${pairInfo.payout}%`,
    mode === "fill" ? "Fill slot" : mode === "relaxed" ? "Relaxed scan" : "Strict scan",
  ].slice(0, 6);

  return {
    quotexPair: pairInfo.pair,
    displayPair: quotexPairToDisplay(pairInfo.pair),
    direction,
    engineScore: clamp(
      (mode === "fill" ? Math.max(analysis.engineScore, 50) : analysis.engineScore) +
        payoutBoost,
      1,
      96
    ),
    daisyScore: analysis.daisyScore,
    confidence: parseFloat(confidence.toFixed(1)),
    reasons,
    payout: pairInfo.payout,
    currencyBase: extractBaseCurrency(pairInfo.pair),
  };
}

async function scanPairsInBatches(
  pairs: MarketPairInfo[],
  isOtc: boolean,
  mode: ScoreMode = "strict",
  batchSize = 8
): Promise<ScoredCandidate[]> {
  const results: ScoredCandidate[] = [];

  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    const scored = await Promise.all(
      batch.map((p) => scorePair(p, isOtc, mode))
    );
    results.push(...scored.filter((s): s is ScoredCandidate => s !== null));
  }

  return results.sort((a, b) => {
    if (b.engineScore !== a.engineScore) return b.engineScore - a.engineScore;
    return b.confidence - a.confidence;
  });
}

function mergeCandidatePools(...pools: ScoredCandidate[][]): ScoredCandidate[] {
  const byPair = new Map<string, ScoredCandidate>();
  for (const pool of pools) {
    for (const c of pool) {
      const key = c.quotexPair.toUpperCase();
      const existing = byPair.get(key);
      if (!existing || c.engineScore > existing.engineScore) {
        byPair.set(key, c);
      }
    }
  }
  return [...byPair.values()].sort((a, b) => {
    if (b.engineScore !== a.engineScore) return b.engineScore - a.engineScore;
    return b.confidence - a.confidence;
  });
}

function diversifyCandidates(
  ranked: ScoredCandidate[],
  limit: number,
  allowReuse = false
): ScoredCandidate[] {
  const picked: ScoredCandidate[] = [];
  const usedPairs = new Set<string>();
  const usedBases = new Set<string>();
  const canDiversify = ranked.length > limit && !allowReuse;

  for (const c of ranked) {
    if (picked.length >= limit) break;
    const pairKey = c.quotexPair.toUpperCase();
    if (usedPairs.has(pairKey)) continue;
    if (canDiversify && usedBases.has(c.currencyBase) && picked.length < limit - 1) {
      continue;
    }
    picked.push(c);
    usedPairs.add(pairKey);
    usedBases.add(c.currencyBase);
  }

  if (picked.length < limit) {
    for (const c of ranked) {
      if (picked.length >= limit) break;
      const pairKey = c.quotexPair.toUpperCase();
      if (!usedPairs.has(pairKey)) {
        picked.push(c);
        usedPairs.add(pairKey);
      }
    }
  }

  // Still short → reuse top pairs (different signal times later)
  if (allowReuse && picked.length < limit && ranked.length > 0) {
    let i = 0;
    while (picked.length < limit) {
      const src = ranked[i % ranked.length];
      picked.push({
        ...src,
        reasons: [...src.reasons.slice(0, 5), "Slot fill"],
      });
      i += 1;
      if (i > limit * 3) break;
    }
  }

  return picked;
}

function pickFromTiers(
  tiers: ScoredCandidate[][],
  count: number,
  allowReuse = false
): ScoredCandidate[] {
  const picked: ScoredCandidate[] = [];
  const usedPairs = new Set<string>();

  for (const tier of tiers) {
    if (picked.length >= count) break;
    const need = count - picked.length;
    const batch = diversifyCandidates(
      tier.filter((c) => !usedPairs.has(c.quotexPair.toUpperCase())),
      need,
      false
    );
    for (const c of batch) {
      const key = c.quotexPair.toUpperCase();
      if (usedPairs.has(key)) continue;
      picked.push(c);
      usedPairs.add(key);
      if (picked.length >= count) break;
    }
  }

  if (picked.length < count) {
    const pool = tiers.flat();
    const extra = diversifyCandidates(pool, count, allowReuse);
    for (const c of extra) {
      if (picked.length >= count) break;
      picked.push(c);
    }
  }

  return picked.slice(0, count);
}

function buildFinalCandidates(
  scored: ScoredCandidate[],
  req: GenerateSignalsRequest,
  gemini: Awaited<ReturnType<typeof confirmSignalsWithGemini>>
): ScoredCandidate[] {
  const elite = scored.filter(
    (c) => c.engineScore >= ELITE_ENGINE && c.confidence >= ELITE_CONF
  );
  const standard = scored.filter(
    (c) => c.engineScore >= MIN_ENGINE && c.confidence >= MIN_CONF - 4
  );

  let geminiApproved: ScoredCandidate[] = [];

  if (gemini.status === "ok" && gemini.rankings.length > 0) {
    const approvedMap = new Map(
      gemini.rankings
        .filter((r) => r.approved && r.geminiConfidence >= MIN_GEMINI_CONFIDENCE)
        .map((r) => [r.pair.toUpperCase().replace(/_OTC$/i, ""), r])
    );

    geminiApproved = scored
      .filter((c) => {
        const key = c.quotexPair.toUpperCase();
        const bare = key.replace(/_OTC$/i, "");
        const display = c.displayPair.toUpperCase().replace("/", "").replace(/\s*\(OTC\)/i, "");
        return (
          approvedMap.has(key) ||
          approvedMap.has(bare) ||
          approvedMap.has(display)
        );
      })
      .map((c) => {
        const key = c.quotexPair.toUpperCase();
        const bare = key.replace(/_OTC$/i, "");
        const display = c.displayPair
          .toUpperCase()
          .replace("/", "")
          .replace(/\s*\(OTC\)/i, "");
        const g =
          approvedMap.get(key) ||
          approvedMap.get(bare) ||
          approvedMap.get(display)!;
        return {
          ...c,
          confidence: parseFloat(
            clamp(
              c.confidence * 0.4 + g.geminiConfidence * 0.6,
              MIN_CONF,
              97
            ).toFixed(1)
          ),
          reasons: [...c.reasons, `Gemini ✓ ${g.note}`],
        };
      });
  }

  // Always fill exact requested count (reuse pairs if needed)
  return pickFromTiers(
    [geminiApproved, elite, standard, scored],
    req.count,
    true
  );
}

function scheduleSignalTimes(count: number): string[] {
  const times: string[] = [];
  let cursor = new Date(Date.now() + UTC_OFFSET_HOURS * 3600 * 1000);

  for (let i = 0; i < count; i++) {
    const gap = SIGNAL_GAPS[Math.min(i, SIGNAL_GAPS.length - 1)];
    cursor = new Date(cursor.getTime() + gap * 60 * 1000);
    const hh = String(cursor.getUTCHours()).padStart(2, "0");
    const mm = String(cursor.getUTCMinutes()).padStart(2, "0");
    times.push(`${hh}:${mm}`);
  }

  return times;
}

/**
 * Always returns exactly `count` signals when market data is available.
 * Progressive scans: strict → relaxed → fill, then Gemini rank, then pad.
 */
export async function generateFutureSignals(
  req: GenerateSignalsRequest
): Promise<GenerateSignalsResult> {
  const health = await checkMarketDataHealth();
  if (health.status !== "ok") {
    return {
      success: false,
      marketType: req.marketType,
      signals: [],
      scannedPairs: 0,
      geminiStatus: "fallback",
      message: "Market data not connected",
    };
  }

  const allPairs = await getAllPairs();
  const isOtc = req.marketType === "OTC";

  const filtered = allPairs.filter((p) => {
    const pair = p.pair.toUpperCase();
    if (!isAllowedMarketPair(pair)) return false;
    if (isOtc) return isOtcPair(pair);
    return !isOtcPair(pair);
  });

  if (filtered.length === 0) {
    return {
      success: false,
      marketType: req.marketType,
      signals: [],
      scannedPairs: 0,
      geminiStatus: "fallback",
      message: `No ${req.marketType} pairs available in market database`,
    };
  }

  // Shuffle lightly so fill passes explore different pairs over time
  const shuffled = [...filtered].sort(() => Math.random() - 0.5);

  let scored = await scanPairsInBatches(shuffled, isOtc, "strict");

  if (scored.length < req.count) {
    const relaxed = await scanPairsInBatches(shuffled, isOtc, "relaxed");
    scored = mergeCandidatePools(scored, relaxed);
  }

  if (scored.length < req.count) {
    const fill = await scanPairsInBatches(shuffled, isOtc, "fill");
    scored = mergeCandidatePools(scored, fill);
  }

  if (scored.length === 0) {
    return {
      success: false,
      marketType: req.marketType,
      signals: [],
      scannedPairs: filtered.length,
      geminiStatus: "fallback",
      message: "No market candles available — try again shortly",
    };
  }

  // Send as many as possible to Gemini (up to 24) for better fill quality
  const geminiPool = diversifyCandidates(
    scored,
    Math.min(Math.max(req.count * 2, req.count), 24),
    false
  );
  const geminiCandidates: GeminiCandidate[] = geminiPool.map((c) => ({
    pair: c.quotexPair,
    direction: c.direction,
    confidence: c.confidence,
    engineScore: c.engineScore,
    reasons: c.reasons,
  }));

  const gemini = await confirmSignalsWithGemini(geminiCandidates, req.marketType);
  let finalCandidates = buildFinalCandidates(scored, req, gemini);

  // Hard guarantee exact count
  if (finalCandidates.length < req.count) {
    finalCandidates = diversifyCandidates(scored, req.count, true);
  }

  const times = scheduleSignalTimes(req.count);

  const signals: FutureSignal[] = finalCandidates.slice(0, req.count).map((c, i) => ({
    id: `sig-${Date.now()}-${i}`,
    time: times[i],
    pair: c.displayPair,
    quotexPair: c.quotexPair,
    direction: c.direction,
    duration: "1 Min",
    confidence: c.confidence,
    engineScore: c.engineScore,
    daisyScore: c.daisyScore,
    reasons: c.reasons,
  }));

  return {
    success: signals.length === req.count,
    marketType: req.marketType,
    signals,
    scannedPairs: filtered.length,
    geminiStatus: gemini.status,
    message:
      signals.length === req.count
        ? undefined
        : `Only ${signals.length}/${req.count} signals available`,
  };
}
