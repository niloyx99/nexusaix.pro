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
/** Bangladesh / app display timezone (matches signalChecker + UI label). */
const UTC_OFFSET_HOURS = 6;

const MIN_PAYOUT_OTC = 70;
const MIN_PAYOUT_REAL = 40;
const MIN_PAYOUT_OTC_RELAXED = 65;
const MIN_PAYOUT_REAL_RELAXED = 35;
const MIN_ENGINE_SCORE = 62;
const MIN_ENGINE_SCORE_STRICT = 70;
const MIN_OUTPUT_CONFIDENCE = 68;
const MIN_INTEL_CONFIDENCE = 52;
const MIN_GEMINI_CONFIDENCE = 75;
const ELITE_ENGINE_SCORE = 72;
const ELITE_CONFIDENCE = 76;
const MIN_BASIC_ENGINE = 55;

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
  if (
    intel.oppositeCandleSignal.detected &&
    intel.priceAction.rejection &&
    intel.confidencePct >= 60
  ) {
    return true;
  }
  if (
    intel.liquiditySweep.detected &&
    intel.priceAction.rejection &&
    confirmations >= 2 &&
    intel.confidencePct >= 58
  ) {
    return true;
  }
  if (fromSnapshot) {
    if (intel.liquiditySweep.detected && intel.priceAction.rejection) return true;
    if (intel.oppositeCandleSignal.detected && intel.confidencePct >= 58) return true;
    if (
      intel.momentum !== "NEUTRAL" &&
      intel.nextCandleDirection !== "SIDEWAYS" &&
      intel.confidencePct >= 54
    ) {
      return true;
    }
  }
  if (confirmations >= 2 && intel.confidencePct >= MIN_INTEL_CONFIDENCE) return true;
  return false;
}

function directionMatchesIntel(
  direction: "CALL" | "PUT",
  intel: ReturnType<typeof analyzeMarketIntelligence>
): boolean {
  const expected = direction === "CALL" ? "UP" : "DOWN";
  if (intel.nextCandleDirection !== expected) return false;
  if (
    intel.oppositeCandleSignal.detected &&
    intel.oppositeCandleSignal.nextBias !== "SIDEWAYS" &&
    intel.oppositeCandleSignal.nextBias !== expected
  ) {
    return false;
  }
  return true;
}

function isEliteCandidate(candidate: ScoredCandidate): boolean {
  return (
    candidate.engineScore >= ELITE_ENGINE_SCORE &&
    candidate.confidence >= ELITE_CONFIDENCE
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function extractBaseCurrency(pair: string): string {
  const base = pair.replace(/_otc$/i, "");
  return base.length >= 6 ? base.slice(0, 3) : base;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((sum, n) => sum + n, 0) / nums.length : 0;
}

function computeRsi(candles: Array<Pick<MarketPairInfo, never> & { close: number }>, period = 8): number | null {
  if (candles.length < period + 1) return null;
  const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let current = avg(values.slice(0, period));
  for (let i = period; i < values.length; i++) {
    current = values[i] * k + current * (1 - k);
  }
  return current;
}

function buildIndicatorConfluence(
  candles: Array<{ close: number }>,
  direction: "CALL" | "PUT"
): { ok: boolean; scoreBoost: number; reasons: string[] } {
  const closes = candles.map((c) => Number(c.close)).filter(Number.isFinite);
  if (closes.length < 10) {
    return { ok: true, scoreBoost: 0, reasons: [] };
  }

  const rsi = computeRsi(candles, 8);
  const ema5 = ema(closes, 5);
  const ema9 = ema(closes, 9);
  const last = closes[closes.length - 1];
  const expectedUp = direction === "CALL";
  const reasons: string[] = [];
  let scoreBoost = 0;

  if (ema5 !== null && ema9 !== null) {
    const emaAligned = expectedUp ? ema5 >= ema9 : ema5 <= ema9;
    if (!emaAligned) return { ok: false, scoreBoost: -8, reasons: [] };
    scoreBoost += 4;
    reasons.push(expectedUp ? "EMA5 > EMA9" : "EMA5 < EMA9");
  }

  if (rsi !== null) {
    const rsiOk = expectedUp ? rsi >= 52 && rsi <= 72 : rsi <= 48 && rsi >= 28;
    if (!rsiOk) return { ok: false, scoreBoost: -10, reasons: [] };
    scoreBoost += 4;
    reasons.push(`RSI ${rsi.toFixed(0)}`);
  }

  if (ema5 !== null) {
    const priceOk = expectedUp ? last >= ema5 : last <= ema5;
    if (!priceOk) return { ok: false, scoreBoost: -6, reasons: [] };
    scoreBoost += 3;
    reasons.push(expectedUp ? "price above EMA5" : "price below EMA5");
  }

  return { ok: true, scoreBoost, reasons };
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
  if (!direction || !directionMatchesIntel(direction, intel)) return null;

  const { daisyScore, engineScore, reasons } = computeDaisyScore(
    intel,
    pairInfo.payout,
    Math.max(pairInfo.candle_count, 1)
  );

  if (engineScore < MIN_ENGINE_SCORE) return null;

  const confidence = clamp(
    engineScore * 0.55 + daisyScore * 0.25 + intel.confidencePct * 0.2,
    MIN_OUTPUT_CONFIDENCE - 6,
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
  isOtc: boolean,
  relaxedPayout = false
): ScoredCandidate | null {
  const minPayout = relaxedPayout
    ? isOtc
      ? MIN_PAYOUT_OTC_RELAXED
      : MIN_PAYOUT_REAL_RELAXED
    : minPayoutForMarket(isOtc);
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

  const adjustedEngine = clamp(engineScore, MIN_BASIC_ENGINE, 84);
  const confidence = clamp(
    adjustedEngine * 0.6 + intel.confidencePct * 0.25 + daisyScore * 0.15,
    MIN_OUTPUT_CONFIDENCE - 8,
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
        if (direction && directionMatchesIntel(direction, intel)) {
          const { daisyScore, engineScore, reasons } = computeDaisyScore(
            intel,
            pairInfo.payout,
            pairInfo.candle_count
          );
          if (engineScore >= MIN_ENGINE_SCORE_STRICT) {
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
  if (!direction || !directionMatchesIntel(direction, intel)) return null;

  const indicator = buildIndicatorConfluence(candles, direction);
  if (!indicator.ok) return null;

  const { daisyScore, engineScore, reasons } = computeDaisyScore(
    intel,
    pairInfo.payout,
    pairInfo.candle_count
  );

  const adjustedEngine = clamp(engineScore + indicator.scoreBoost, 1, 99);
  if (adjustedEngine < MIN_ENGINE_SCORE) return null;

  const confidence = clamp(
    adjustedEngine * 0.65 +
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
    engineScore: adjustedEngine,
    daisyScore,
    confidence: parseFloat(confidence.toFixed(1)),
    reasons: [...reasons, ...indicator.reasons],
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
  isOtc: boolean,
  relaxedPayout = false
): Promise<ScoredCandidate[]> {
  const results = pairs
    .map((p) => scoreMomentumFallback(p, isOtc, relaxedPayout))
    .filter((s): s is ScoredCandidate => s !== null);

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

function pickFromTiers(tiers: ScoredCandidate[][], count: number): ScoredCandidate[] {
  const picked: ScoredCandidate[] = [];
  const usedPairs = new Set<string>();

  for (const tier of tiers) {
    if (picked.length >= count) break;
    const need = count - picked.length;
    const batch = diversifyCandidates(
      tier.filter((c) => !usedPairs.has(c.quotexPair.toUpperCase())),
      need
    );
    for (const c of batch) {
      const key = c.quotexPair.toUpperCase();
      if (usedPairs.has(key)) continue;
      picked.push(c);
      usedPairs.add(key);
      if (picked.length >= count) break;
    }
  }

  return picked.slice(0, count);
}

function buildFinalCandidates(
  scored: ScoredCandidate[],
  req: GenerateSignalsRequest,
  gemini: Awaited<ReturnType<typeof confirmSignalsWithGemini>>
): ScoredCandidate[] {
  const elite = scored.filter(isEliteCandidate);
  const standard = scored.filter(
    (c) => c.engineScore >= MIN_ENGINE_SCORE && c.confidence >= MIN_OUTPUT_CONFIDENCE - 4
  );

  let geminiApproved: ScoredCandidate[] = [];
  if (gemini.status === "ok" && gemini.rankings.length > 0) {
    const approvedMap = new Map(
      gemini.rankings
        .filter((r) => r.approved && r.geminiConfidence >= MIN_GEMINI_CONFIDENCE)
        .map((r) => [r.pair.toUpperCase(), r])
    );

    geminiApproved = scored
      .filter((c) => approvedMap.has(c.quotexPair.toUpperCase()))
      .map((c) => {
        const g = approvedMap.get(c.quotexPair.toUpperCase())!;
        return {
          ...c,
          confidence: parseFloat(
            clamp(c.confidence * 0.4 + g.geminiConfidence * 0.6, MIN_OUTPUT_CONFIDENCE, 97).toFixed(1)
          ),
          reasons: [...c.reasons, `Gemini ✓ ${g.note}`],
        };
      });
  }

  return pickFromTiers(
    [geminiApproved, elite, standard, scored],
    req.count
  );
}

function diversifyCandidates(
  ranked: ScoredCandidate[],
  limit: number
): ScoredCandidate[] {
  const picked: ScoredCandidate[] = [];
  const usedPairs = new Set<string>();
  const usedBases = new Set<string>();
  const canDiversify = ranked.length > limit;

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

  return picked;
}

function scheduleSignalTimes(count: number): string[] {
  const times: string[] = [];
  // Shift into UTC+6 so displayed times match the user's local clock (not server UTC).
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

  if (scored.length < req.count) {
    const momentum = await scanMomentumFallback(filtered, isOtc);
    scored = mergeCandidatePools(scored, momentum);
  }

  if (scored.length < req.count) {
    const relaxed = await scanMomentumFallback(filtered, isOtc, true);
    scored = mergeCandidatePools(scored, relaxed);
  }

  if (scored.length === 0) {
    return {
      success: false,
      marketType: req.marketType,
      signals: [],
      scannedPairs: filtered.length,
      geminiStatus: "fallback",
      message: "No directional setups right now — try again in 1–2 minutes",
    };
  }

  const geminiPool = diversifyCandidates(scored, Math.min(req.count * 2, 20));

  const geminiCandidates: GeminiCandidate[] = geminiPool.map((c) => ({
    pair: c.quotexPair,
    direction: c.direction,
    confidence: c.confidence,
    engineScore: c.engineScore,
    reasons: c.reasons,
  }));

  const gemini = await confirmSignalsWithGemini(geminiCandidates, req.marketType);
  const finalCandidates = buildFinalCandidates(scored, req, gemini);

  const times = scheduleSignalTimes(req.count);

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
