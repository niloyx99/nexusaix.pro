import {
  checkMarketDataHealth,
  getAllPairs,
  getRecentCandles,
  quotexPairToDisplay,
  type MarketPairInfo,
} from "./marketDataClient.js";
import { isAllowedMarketPair, isOtcPair } from "../config/allowedMarkets.js";
import { analyzeMarketIntelligence, analyzeLiveSnapshotOHLC, snapshotDirectionFromOHLC } from "./marketIntelligence.js";
import {
  confirmSignalsWithGemini,
  type GeminiCandidate,
} from "./geminiConfirm.js";

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

const SIGNAL_GAPS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20];

const MIN_PAYOUT_OTC = 70;
const MIN_PAYOUT_REAL = 55;
const MIN_ENGINE_SCORE = 58;
const MIN_ENGINE_SCORE_STRICT = 65;
const MIN_OUTPUT_CONFIDENCE = 68;
const MIN_INTEL_CONFIDENCE = 52;

function minPayoutForMarket(isOtc: boolean): number {
  return isOtc ? MIN_PAYOUT_OTC : MIN_PAYOUT_REAL;
}

function countConfirmations(
  intel: ReturnType<typeof analyzeMarketIntelligence>
): number {
  let count = 0;
  if (intel.liquiditySweep.detected) count += 1;
  if (intel.oppositeCandleSignal.detected) count += 1;
  if (intel.mmxm.phase === "MANIPULATION" || intel.mmxm.phase === "EXPANSION") count += 1;
  if (intel.msnr.signal !== "NONE") count += 1;
  if (intel.priceAction.rejection) count += 1;
  if (intel.momentum !== "NEUTRAL") count += 1;
  if (
    intel.priceAction.pattern.includes("ENGULFING") ||
    intel.priceAction.pattern.includes("BREAKOUT")
  ) {
    count += 1;
  }
  return count;
}

function hasPremiumSetup(
  intel: ReturnType<typeof analyzeMarketIntelligence>,
  fromSnapshot = false
): boolean {
  const confirmations = countConfirmations(intel);
  if (intel.oppositeCandleSignal.detected && intel.liquiditySweep.detected) return true;
  if (intel.oppositeCandleSignal.detected && intel.priceAction.rejection) return true;
  if (fromSnapshot && intel.priceAction.rejection && intel.confidencePct >= 58) return true;
  if (
    fromSnapshot &&
    intel.momentum !== "NEUTRAL" &&
    intel.nextCandleDirection !== "SIDEWAYS" &&
    intel.confidencePct >= 58
  ) {
    return true;
  }
  if (intel.oppositeCandleSignal.detected && confirmations >= 2) return true;
  if (confirmations >= 2 && intel.confidencePct >= MIN_INTEL_CONFIDENCE) return true;
  return false;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function extractBaseCurrency(pair: string): string {
  const base = pair.replace(/_otc$/i, "");
  return base.length >= 6 ? base.slice(0, 3) : base;
}

/**
 * Daisy Chain — layered confirmation petals (each 0–100, weighted):
 * 1 Data quality  2 SMC liquidity  3 MSNR/MMXM structure
 * 4 Momentum/direction  5 Parallel pair quality (payout + diversity)
 */
function computeDaisyScore(
  intel: ReturnType<typeof analyzeMarketIntelligence>,
  payout: number,
  candleCount: number
): { daisyScore: number; engineScore: number; reasons: string[] } {
  const reasons: string[] = [];

  const dataLayer = clamp(
    (candleCount >= 15 ? 40 : candleCount >= 10 ? 30 : 15) +
      (payout >= 90 ? 35 : payout >= 80 ? 28 : payout >= 70 ? 20 : 10),
    0,
    100
  );
  if (payout >= 85) reasons.push(`High payout ${payout}%`);

  let smcLayer = 20;
  if (intel.liquiditySweep.detected) {
    smcLayer = 88;
    reasons.push(intel.liquiditySweep.type.replace("_", " "));
  }

  let structureLayer = 25;
  if (intel.mmxm.phase === "MANIPULATION") {
    structureLayer = 82;
    reasons.push(`${intel.mmxm.model} manipulation`);
  } else if (intel.mmxm.phase === "EXPANSION") {
    structureLayer = 70;
    reasons.push("MMXM expansion");
  }
  if (intel.msnr.signal !== "NONE") {
    structureLayer = clamp(structureLayer + 12, 0, 100);
    reasons.push(`MSNR ${intel.msnr.signal}`);
  }

  let momentumLayer = 30;
  if (intel.momentum !== "NEUTRAL") {
    momentumLayer = 65;
    reasons.push(`${intel.momentum} momentum`);
  }
  if (intel.oppositeCandleSignal.detected) {
    momentumLayer = clamp(momentumLayer + 20, 0, 100);
    reasons.push("Opposite-candle reversal");
  }
  if (intel.priceAction.rejection) {
    momentumLayer = clamp(momentumLayer + 10, 0, 100);
    reasons.push(intel.priceAction.pattern);
  }

  const parallelLayer = clamp(
    payout * 0.4 + intel.confidencePct * 0.6,
    0,
    100
  );

  const daisyScore = clamp(
    dataLayer * 0.15 +
      smcLayer * 0.25 +
      structureLayer * 0.25 +
      momentumLayer * 0.25 +
      parallelLayer * 0.1,
    1,
    99
  );

  const engineScore = clamp(
    intel.confidencePct * 0.6 + daisyScore * 0.4,
    1,
    99
  );

  if (intel.oppositeCandleSignal.detected && intel.liquiditySweep.detected) {
    reasons.push("Premium: sweep + next-candle reversal");
  }

  return { daisyScore, engineScore, reasons };
}

function directionFromIntel(
  intel: ReturnType<typeof analyzeMarketIntelligence>
): "CALL" | "PUT" | null {
  const dir = intel.nextCandleDirection;
  if (dir === "UP") return "CALL";
  if (dir === "DOWN") return "PUT";
  return null;
}

function scorePairFromSnapshot(
  pairInfo: MarketPairInfo,
  isOtc: boolean
): ScoredCandidate | null {
  const minPayout = minPayoutForMarket(isOtc);
  if (pairInfo.payout < minPayout) return null;

  if (
    pairInfo.open === undefined ||
    pairInfo.high === undefined ||
    pairInfo.low === undefined ||
    pairInfo.close === undefined
  ) {
    return null;
  }

  const intel = analyzeLiveSnapshotOHLC(
    {
      open: pairInfo.open,
      high: pairInfo.high,
      low: pairInfo.low,
      close: pairInfo.close,
    },
    { isOtc, payoutPercent: pairInfo.payout }
  );

  if (intel.nextCandleDirection === "SIDEWAYS") return null;
  if (!hasPremiumSetup(intel, true)) return null;

  const direction = directionFromIntel(intel);
  if (!direction) return null;

  const { daisyScore, engineScore, reasons } = computeDaisyScore(
    intel,
    pairInfo.payout,
    Math.max(pairInfo.candle_count, 1)
  );

  if (engineScore < MIN_ENGINE_SCORE) return null;

  const confidence = clamp(
    engineScore * 0.55 + daisyScore * 0.25 + intel.confidencePct * 0.2,
    MIN_OUTPUT_CONFIDENCE,
    92
  );

  return {
    quotexPair: pairInfo.pair,
    displayPair: quotexPairToDisplay(pairInfo.pair),
    direction,
    engineScore,
    daisyScore,
    confidence: parseFloat(confidence.toFixed(1)),
    reasons: [...reasons, ...intel.fusionBullets.slice(0, 2)],
    payout: pairInfo.payout,
    currencyBase: extractBaseCurrency(pairInfo.pair),
  };
}

function scoreMomentumFallback(
  pairInfo: MarketPairInfo,
  isOtc: boolean
): ScoredCandidate | null {
  const minPayout = minPayoutForMarket(isOtc);
  if (pairInfo.payout < minPayout) return null;

  if (
    pairInfo.open === undefined ||
    pairInfo.high === undefined ||
    pairInfo.low === undefined ||
    pairInfo.close === undefined
  ) {
    return null;
  }

  const intel = analyzeLiveSnapshotOHLC(
    {
      open: pairInfo.open,
      high: pairInfo.high,
      low: pairInfo.low,
      close: pairInfo.close,
    },
    { isOtc, payoutPercent: pairInfo.payout }
  );

  if (intel.nextCandleDirection === "SIDEWAYS") return null;

  const direction = directionFromIntel(intel);
  if (!direction) return null;

  const { daisyScore, engineScore, reasons } = computeDaisyScore(
    intel,
    pairInfo.payout,
    Math.max(pairInfo.candle_count, 1)
  );

  const adjustedEngine = clamp(engineScore, MIN_ENGINE_SCORE, 84);
  const confidence = clamp(
    adjustedEngine * 0.6 + intel.confidencePct * 0.25 + daisyScore * 0.15,
    MIN_OUTPUT_CONFIDENCE,
    86
  );

  return {
    quotexPair: pairInfo.pair,
    displayPair: quotexPairToDisplay(pairInfo.pair),
    direction,
    engineScore: adjustedEngine,
    daisyScore,
    confidence: parseFloat(confidence.toFixed(1)),
    reasons: [...reasons, `Live ${intel.momentum.toLowerCase()} momentum`],
    payout: pairInfo.payout,
    currencyBase: extractBaseCurrency(pairInfo.pair),
  };
}

async function scorePair(
  pairInfo: MarketPairInfo,
  isOtc: boolean
): Promise<ScoredCandidate | null> {
  const minPayout = minPayoutForMarket(isOtc);
  if (pairInfo.payout < minPayout) return null;

  const candleData = await getRecentCandles(pairInfo.pair, 60);
  const candles = candleData?.candles ?? [];

  if (!candles.length) {
    return scorePairFromSnapshot(pairInfo, isOtc);
  }

  if (candles.length < 5) {
    return (
      scorePairFromSnapshot(pairInfo, isOtc) ??
      scoreMomentumFallback(pairInfo, isOtc)
    );
  }

  if (candles.length < 8) {
    if (
      pairInfo.open !== undefined &&
      pairInfo.high !== undefined &&
      pairInfo.low !== undefined &&
      pairInfo.close !== undefined
    ) {
      const snapDir = snapshotDirectionFromOHLC(
        pairInfo.open,
        pairInfo.high,
        pairInfo.low,
        pairInfo.close
      );
      const intel = analyzeLiveSnapshotOHLC(
        { open: pairInfo.open, high: pairInfo.high, low: pairInfo.low, close: pairInfo.close },
        { isOtc, payoutPercent: pairInfo.payout }
      );
      if (snapDir !== "SIDEWAYS" && hasPremiumSetup(intel, true)) {
        const direction = directionFromIntel(intel);
        if (direction) {
          const { daisyScore, engineScore, reasons } = computeDaisyScore(
            intel,
            pairInfo.payout,
            pairInfo.candle_count
          );
          if (engineScore >= MIN_ENGINE_SCORE) {
            return {
              quotexPair: pairInfo.pair,
              displayPair: quotexPairToDisplay(pairInfo.pair),
              direction,
              engineScore,
              daisyScore,
              confidence: parseFloat(
                clamp(engineScore * 0.6 + intel.confidencePct * 0.4, MIN_OUTPUT_CONFIDENCE, 91).toFixed(1)
              ),
              reasons,
              payout: pairInfo.payout,
              currencyBase: extractBaseCurrency(pairInfo.pair),
            };
          }
        }
      }
    }
    return (
      scorePairFromSnapshot(pairInfo, isOtc) ??
      scoreMomentumFallback(pairInfo, isOtc)
    );
  }

  const intel = analyzeMarketIntelligence(candles, {
    isOtc,
    payoutPercent: pairInfo.payout,
  });

  if (intel.nextCandleDirection === "SIDEWAYS") return null;
  if (intel.confidencePct < MIN_INTEL_CONFIDENCE) return null;
  if (!hasPremiumSetup(intel)) return null;

  const direction = directionFromIntel(intel);
  if (!direction) return null;

  const { daisyScore, engineScore, reasons } = computeDaisyScore(
    intel,
    pairInfo.payout,
    pairInfo.candle_count
  );

  if (engineScore < MIN_ENGINE_SCORE_STRICT) return null;

  let confidence = clamp(
    engineScore * 0.65 +
      daisyScore * 0.25 +
      intel.confidencePct * 0.1 +
      (intel.liquiditySweep.detected && intel.oppositeCandleSignal.detected ? 8 : 0) +
      (intel.oppositeCandleSignal.detected ? 4 : 0),
    MIN_OUTPUT_CONFIDENCE,
    97
  );

  return {
    quotexPair: pairInfo.pair,
    displayPair: quotexPairToDisplay(pairInfo.pair),
    direction,
    engineScore,
    daisyScore,
    confidence: parseFloat(confidence.toFixed(1)),
    reasons,
    payout: pairInfo.payout,
    currencyBase: extractBaseCurrency(pairInfo.pair),
  };
}

async function scanPairsInBatches(
  pairs: MarketPairInfo[],
  isOtc: boolean,
  batchSize = 8
): Promise<ScoredCandidate[]> {
  const results: ScoredCandidate[] = [];

  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    const scored = await Promise.all(batch.map((p) => scorePair(p, isOtc)));
    results.push(...scored.filter((s): s is ScoredCandidate => s !== null));
  }

  return results.sort((a, b) => {
    if (b.engineScore !== a.engineScore) return b.engineScore - a.engineScore;
    return b.confidence - a.confidence;
  });
}

async function scanMomentumFallback(
  pairs: MarketPairInfo[],
  isOtc: boolean
): Promise<ScoredCandidate[]> {
  const results = pairs
    .map((p) => scoreMomentumFallback(p, isOtc))
    .filter((s): s is ScoredCandidate => s !== null);

  return results.sort((a, b) => {
    if (b.engineScore !== a.engineScore) return b.engineScore - a.engineScore;
    return b.confidence - a.confidence;
  });
}

function buildFinalCandidates(
  scored: ScoredCandidate[],
  req: GenerateSignalsRequest,
  gemini: Awaited<ReturnType<typeof confirmSignalsWithGemini>>
): ScoredCandidate[] {
  if (gemini.status !== "ok" || gemini.rankings.length === 0) {
    return diversifyCandidates(scored, req.count).map((c) => ({
      ...c,
      reasons: [...c.reasons, "Engine-confirmed live setup"],
    }));
  }

  const approvedMap = new Map(
    gemini.rankings
      .filter((r) => r.approved)
      .map((r) => [r.pair.toUpperCase(), r])
  );

  let finalCandidates = scored
    .filter((c) => approvedMap.has(c.quotexPair.toUpperCase()))
    .map((c) => {
      const g = approvedMap.get(c.quotexPair.toUpperCase())!;
      return {
        ...c,
        confidence: parseFloat(
          clamp(c.confidence * 0.55 + g.geminiConfidence * 0.45, MIN_OUTPUT_CONFIDENCE, 97).toFixed(1)
        ),
        reasons: [...c.reasons, `Gemini: ${g.note}`],
      };
    });

  if (finalCandidates.length < req.count) {
    const enginePicks = scored.filter(
      (c) => c.engineScore >= MIN_ENGINE_SCORE && c.confidence >= MIN_OUTPUT_CONFIDENCE
    );
    const pool = enginePicks.length > 0 ? enginePicks : scored;
    finalCandidates = diversifyCandidates(pool, req.count).map((c) => ({
      ...c,
      reasons: [...c.reasons, finalCandidates.length ? "Engine top pick" : "Live momentum pick"],
    }));
  } else {
    finalCandidates = diversifyCandidates(finalCandidates, req.count);
  }

  return finalCandidates.slice(0, req.count);
}

function diversifyCandidates(
  ranked: ScoredCandidate[],
  limit: number
): ScoredCandidate[] {
  const picked: ScoredCandidate[] = [];
  const usedBases = new Set<string>();

  for (const c of ranked) {
    if (picked.length >= limit) break;
    if (usedBases.has(c.currencyBase) && picked.length < limit - 2) continue;
    picked.push(c);
    usedBases.add(c.currencyBase);
  }

  if (picked.length < limit) {
    for (const c of ranked) {
      if (picked.length >= limit) break;
      if (!picked.find((p) => p.quotexPair === c.quotexPair)) {
        picked.push(c);
      }
    }
  }

  return picked;
}

function scheduleSignalTimes(count: number): string[] {
  const times: string[] = [];
  let cursor = new Date();

  for (let i = 0; i < count; i++) {
    const gap = SIGNAL_GAPS[Math.min(i, SIGNAL_GAPS.length - 1)];
    cursor = new Date(cursor.getTime() + gap * 60 * 1000);
    const hh = String(cursor.getHours()).padStart(2, "0");
    const mm = String(cursor.getMinutes()).padStart(2, "0");
    times.push(`${hh}:${mm}`);
  }

  return times;
}

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

  let scored = await scanPairsInBatches(filtered, isOtc);

  if (scored.length === 0) {
    scored = await scanMomentumFallback(filtered, isOtc);
  }

  if (scored.length === 0) {
    return {
      success: false,
      marketType: req.marketType,
      signals: [],
      scannedPairs: filtered.length,
      geminiStatus: "fallback",
      message: "No clear directional setups right now — try again in 1–2 minutes",
    };
  }

  const geminiPool = diversifyCandidates(scored, Math.min(req.count * 3, 15));

  const geminiCandidates: GeminiCandidate[] = geminiPool.map((c) => ({
    pair: c.quotexPair,
    direction: c.direction,
    confidence: c.confidence,
    engineScore: c.engineScore,
    reasons: c.reasons,
  }));

  const gemini = await confirmSignalsWithGemini(geminiCandidates, req.marketType);
  const finalCandidates = buildFinalCandidates(scored, req, gemini);
  const times = scheduleSignalTimes(finalCandidates.length);

  const signals: FutureSignal[] = finalCandidates.map((c, i) => ({
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
    success: true,
    marketType: req.marketType,
    signals,
    scannedPairs: filtered.length,
    geminiStatus: gemini.status,
  };
}
