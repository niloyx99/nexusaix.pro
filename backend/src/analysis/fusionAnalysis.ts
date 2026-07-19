import {

  analyzeChartImage,

  type AnalysisResult,

} from "./openrouter.js";

import {
  checkMarketDataHealth,
  getPairInfo,
  getRecentCandles,
  isMarketDataReady,
  titleToQuotexPair,
} from "../market/marketDataClient.js";
import { isAllowedMarketPair } from "../config/allowedMarkets.js";

import {

  analyzeMarketIntelligence,

  analyzeLiveSnapshotOHLC,

  snapshotDirectionFromOHLC,

  type Bias,

  type Direction,

  type MarketIntelligence,

} from "./marketIntelligence.js";
import {
  applyTradeSetupRules,
  type SetupGateResult,
} from "./tradeSetupRules.js";
import type { MarketCandle } from "../market/marketDataClient.js";
import {
  analyzeRealMarket,
  blendRealMarketSignal,
  type RealMarketSignal,
} from "./realMarketAnalysis.js";

export type PreferredMarketMode = "REAL" | "OTC";



export interface AnalysisSources {

  gemini: {

    model: string;

    status: "ok" | "fallback";

  };

  marketData: {

    status: "ok" | "offline" | "pair_not_found" | "no_candles";

    apiUrl: string;

    pair: string;

    candlesUsed: number;

    payoutPercent: number | null;

  };

}



export interface FusedAnalysisResult extends AnalysisResult {

  nextCandleDirection: "UP" | "DOWN" | "SIDEWAYS";

  fusionConfidencePct: number;

  fusionConfidenceVal: string;

  quotexPair: string;

  payoutPercent: number | null;

  analysisSources: AnalysisSources;

  marketMomentum: "BULLISH" | "BEARISH" | "NEUTRAL";

  marketDataSummary: string;

  /** Light UI: REAL vs OTC rule engine */
  setupMode?: "REAL" | "OTC";
  setupNote?: string;
  setupFilters?: string[];
  martingaleHint?: "1-step" | "none";

}



function clamp(n: number, min = 1, max = 99): number {

  return Math.max(min, Math.min(max, Math.round(n)));

}

/** User-facing win rate — never fake 99%, not stuck at flat 50. */
function clampWinRate(n: number): number {
  return clamp(n, 48, 88);
}



function trendToDirection(trend: AnalysisResult["trend"]): Direction {

  if (trend === "BULLISH") return "UP";

  if (trend === "BEARISH") return "DOWN";

  return "SIDEWAYS";

}



function directionsAlign(a: Direction, b: Direction): boolean {

  if (a === "SIDEWAYS" || b === "SIDEWAYS") return false;

  return a === b;

}



function recommendationToDirection(
  rec: AnalysisResult["recommendation"]
): Direction {
  if (rec === "STRONG BUY" || rec === "BUY") return "UP";
  if (rec === "STRONG SELL" || rec === "SELL") return "DOWN";
  return "SIDEWAYS";
}

function geminiTradeDirection(gemini: AnalysisResult): Direction {
  const fromRec = recommendationToDirection(gemini.recommendation);
  if (fromRec !== "SIDEWAYS") return fromRec;
  return trendToDirection(gemini.trend);
}

function fuseRecommendation(

  gemini: AnalysisResult,

  intel: MarketIntelligence | null,

  fusedDirection: Direction,

  fusionConfidence: number,

  isOtc = false

): AnalysisResult["recommendation"] {

  let direction: Direction = fusedDirection;

  // Prefer live intel when fusion was sideways.
  if (direction === "SIDEWAYS" && intel?.nextCandleDirection && intel.nextCandleDirection !== "SIDEWAYS") {
    if (intel.confidencePct >= (isOtc ? 56 : 52)) {
      direction = intel.nextCandleDirection;
    }
  }

  if (direction === "SIDEWAYS") {
    const fromGemini = geminiTradeDirection(gemini);
    if (fromGemini !== "SIDEWAYS" && fusionConfidence >= (isOtc ? 60 : 54)) {
      direction = fromGemini;
    }
  }

  const minConfidence = isOtc ? 56 : 52;

  const bullish = direction === "UP";
  const bearish = direction === "DOWN";

  const strong =
    fusionConfidence >= (isOtc ? 76 : 78) &&
    direction !== "SIDEWAYS" &&
    Boolean(
      isOtc
        ? intel?.lmp?.aligned || intel?.priceAction.rejection
        : intel?.liquiditySweep.detected ||
            intel?.oppositeCandleSignal.detected ||
            intel?.priceAction.rejection
    );

  if (direction === "SIDEWAYS" || fusionConfidence < minConfidence) {
    return "HOLD";
  }

  if (bullish && !bearish) {
    return strong ? "STRONG BUY" : "BUY";
  }

  if (bearish && !bullish) {
    return strong ? "STRONG SELL" : "SELL";
  }

  return "HOLD";
}



function buildFusionConfidence(
  gemini: AnalysisResult,
  intel: MarketIntelligence | null,
  marketOk: boolean,
  payout: number | null,
  fusedDirection: Direction,
  candlesUsed: number,
  directionsConflict: boolean
): number {
  const thinData = candlesUsed < 8;
  const geminiDir = geminiTradeDirection(gemini);

  // Chart + live blend (mid-range base). Old code stacked +40 bonuses → always 99%.
  const chart = clamp(gemini.winRatePct, 52, 82);
  const live = intel ? clamp(intel.confidencePct, 52, 84) : 58;

  let score =
    marketOk && intel
      ? thinData
        ? chart * 0.62 + live * 0.38
        : chart * 0.42 + live * 0.58
      : chart * 0.9;

  let bonus = 0;
  if (marketOk && intel) {
    if (directionsAlign(geminiDir, intel.nextCandleDirection)) bonus += 4;
    if (directionsAlign(geminiDir, fusedDirection)) bonus += 3;
    if (directionsAlign(intel.nextCandleDirection, fusedDirection)) bonus += 3;
    if (
      (gemini.trend === "BULLISH" && intel.momentum === "BULLISH") ||
      (gemini.trend === "BEARISH" && intel.momentum === "BEARISH")
    ) {
      bonus += 3;
    } else if (
      geminiDir !== "SIDEWAYS" &&
      intel.momentum !== "NEUTRAL" &&
      !directionsAlign(geminiDir, intel.nextCandleDirection)
    ) {
      bonus -= 6;
    }

    if (intel.liquiditySweep.detected && intel.oppositeCandleSignal.detected) bonus += 4;
    else if (intel.liquiditySweep.detected || intel.oppositeCandleSignal.detected) bonus += 2;
    if (intel.priceAction.rejection) bonus += 2;
    if (intel.lmp?.aligned && directionsAlign(intel.lmp.direction, fusedDirection)) bonus += 1;
  } else if (!thinData) {
    bonus -= 6;
  }

  // Cap total bonus so scores spread across 55–85 instead of slamming into 99.
  bonus = Math.max(-12, Math.min(bonus, 11));
  score += bonus;

  if (directionsConflict) score -= 9;
  if (fusedDirection === "SIDEWAYS") score = Math.min(score, 56);
  if (gemini.recommendation === "HOLD" && gemini.trend === "NEUTRAL") {
    score = Math.min(score, 54);
  }

  if (payout && payout >= 80) score += 1;
  if (payout && payout > 0 && payout < 55) score -= 3;

  return clampWinRate(score);
}



function resolveFusedDirection(

  gemini: AnalysisResult,

  intel: MarketIntelligence | null,

  candlesUsed: number,

  snapshot?: { open: number; high: number; low: number; close: number } | null,

  _isOtc = false

): { direction: Direction; conflict: boolean } {

  const geminiDir = geminiTradeDirection(gemini);
  const thinData = candlesUsed < 8;

  // OTC simple engine: wick/volume/LMP intel leads; Gemini only confirms.
  if (_isOtc && intel && intel.nextCandleDirection !== "SIDEWAYS" && intel.confidencePct >= 56) {
    if (geminiDir === "SIDEWAYS" || geminiDir === intel.nextCandleDirection) {
      return { direction: intel.nextCandleDirection, conflict: false };
    }
    if (intel.confidencePct >= gemini.winRatePct) {
      return { direction: intel.nextCandleDirection, conflict: true };
    }
  }

  // Classic fusion for REAL (and OTC fallback)
  if (geminiDir === "SIDEWAYS") {

    if (intel?.nextCandleDirection && intel.nextCandleDirection !== "SIDEWAYS") {

      return { direction: intel.nextCandleDirection, conflict: false };

    }

    return { direction: "SIDEWAYS", conflict: false };

  }

  if (!intel || thinData) {
    if (snapshot) {
      const snapDir = snapshotDirectionFromOHLC(
        snapshot.open,
        snapshot.high,
        snapshot.low,
        snapshot.close
      );
      if (snapDir !== "SIDEWAYS" && directionsAlign(geminiDir, snapDir)) {
        return { direction: geminiDir, conflict: false };
      }
      if (snapDir !== "SIDEWAYS" && !directionsAlign(geminiDir, snapDir)) {
        return { direction: "SIDEWAYS", conflict: true };
      }
    }
    return { direction: geminiDir, conflict: false };
  }

  if (intel.oppositeCandleSignal.detected && intel.liquiditySweep.detected) {
    const dir = intel.oppositeCandleSignal.nextBias;
    return {
      direction: directionsAlign(geminiDir, dir) ? dir : geminiDir,
      conflict: !directionsAlign(geminiDir, dir),
    };
  }

  if (directionsAlign(geminiDir, intel.nextCandleDirection)) {
    return { direction: intel.nextCandleDirection, conflict: false };
  }

  if (intel.confidencePct >= 72 && intel.oppositeCandleSignal.detected) {
    return {
      direction: intel.oppositeCandleSignal.nextBias,
      conflict: !directionsAlign(geminiDir, intel.oppositeCandleSignal.nextBias),
    };
  }

  if (intel.confidencePct > gemini.winRatePct + 8) {
    return { direction: intel.nextCandleDirection, conflict: true };
  }

  return { direction: geminiDir, conflict: true };
}



function mergeAnalysisText(

  geminiText: string,

  intel: MarketIntelligence | null,

  fusedDirection: Direction,

  fusionConfidence: number,

  quotexPair: string,

  payout: number | null,

  directionsConflict = false,

  setup?: SetupGateResult | null

): string {

  const shortGemini = (geminiText || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 140);

  if (!intel) {
    return `### Simple Signal\n* **${quotexPair}** → **${fusedDirection}** (${fusionConfidence}%)\n* ${shortGemini || "Chart-only read."}`;
  }

  const setupLine = setup?.note
    ? `* **Setup**: ${setup.note}${setup.filters[0] ? ` · ${setup.filters[0]}` : ""}`
    : null;

  return [
    "### Simple Signal",
    `* **Pair**: ${quotexPair}${payout ? ` · Payout ${payout}%` : ""}`,
    `* **Next candle**: **${fusedDirection}** · **${fusionConfidence}%**${directionsConflict ? " (conflict → careful)" : ""}`,
    `* **Live**: ${intel.momentum} · ${intel.nextCandleDirection}`,
    setupLine,
    setup?.martingaleHint === "1-step" ? `* **MTG**: 1-step recovery if first candle fails` : null,
    shortGemini ? `* **Chart**: ${shortGemini}` : null,
    fusionConfidence < 66 ? `* **Tip**: Confidence low — prefer HOLD / skip MTG.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function alignKpiWithFusion(

  gemini: AnalysisResult,

  intel: MarketIntelligence | null,

  fusedDirection: Direction,

  fusionConfidence: number

): Pick<

  AnalysisResult,

  | "supportVal"

  | "supportPct"

  | "resistanceVal"

  | "resistancePct"

  | "signalQualityVal"

  | "signalQualityPct"

  | "trend"

> {

  let trend: AnalysisResult["trend"] = gemini.trend;

  if (fusedDirection === "UP") trend = "BULLISH";

  if (fusedDirection === "DOWN") trend = "BEARISH";



  let signalQualityVal = gemini.signalQualityVal;

  let signalQualityPct = gemini.signalQualityPct;



  if (intel?.liquiditySweep.detected && intel.oppositeCandleSignal.detected) {

    signalQualityVal = "EXCELLENT";

    signalQualityPct = clamp(Math.max(signalQualityPct, fusionConfidence - 2));

  } else if (intel?.msnr.signal !== "NONE" || intel?.priceAction.rejection) {

    signalQualityVal = "STRONG";

    signalQualityPct = clamp(Math.max(signalQualityPct, fusionConfidence - 5));

  }



  let supportVal = gemini.supportVal;

  let resistanceVal = gemini.resistanceVal;

  let supportPct = gemini.supportPct;

  let resistancePct = gemini.resistancePct;



  if (intel?.msnr.support) {

    supportVal = intel.msnr.support.toFixed(5);

    supportPct = clamp(supportPct + (intel.msnr.signal === "SBR" ? 6 : 2));

  }

  if (intel?.msnr.resistance) {

    resistanceVal = intel.msnr.resistance.toFixed(5);

    resistancePct = clamp(resistancePct + (intel.msnr.signal === "RBS" ? 6 : 2));

  }



  return {

    trend,

    supportVal,

    supportPct,

    resistanceVal,

    resistancePct,

    signalQualityVal,

    signalQualityPct,

  };

}



/**
 * Chart fusion — marketMode is REQUIRED and locks the engine:
 * REAL → realMarketAnalysis + applyRealMarketSetup
 * OTC  → wick + volume + LMP only (simple engine)
 */
export async function analyzeWithFusion(
  image: string,
  options: { preferredMarket: PreferredMarketMode }
): Promise<FusedAnalysisResult> {
  const preferred = options.preferredMarket;
  if (preferred !== "REAL" && preferred !== "OTC") {
    throw Object.assign(new Error("preferredMarket must be REAL or OTC"), {
      code: "INVALID_MARKET_MODE",
    });
  }

  const isOtcMarket = preferred === "OTC";
  const model = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";

  const health = await checkMarketDataHealth({ force: !isMarketDataReady() });

  const marketApiUrl =
    health.url || process.env.QUOTEX_MARKET_API_URL || "http://161.248.189.73:1339";

  if (health.status !== "ok") {
    throw Object.assign(new Error("Market data feed offline"), {
      code: "MARKET_DATA_OFFLINE",
    });
  }

  // Vision locked to the selected analyzer tab — never infer the other market
  const gemini = await analyzeChartImage(image, { marketType: preferred });
  const geminiIsFallback = gemini.analysisText.includes("Simulation mode");
  gemini.marketType = preferred;

  const quotexPair = titleToQuotexPair(gemini.analysisTitle, preferred);

  let marketStatus: AnalysisSources["marketData"]["status"] = "offline";
  let candlesUsed = 0;
  let payoutPercent: number | null = null;
  let momentum: Bias = "NEUTRAL";
  let nextDirection: Direction = "SIDEWAYS";
  let marketDataSummary = "Quotex market data API is offline.";
  let intel: MarketIntelligence | null = null;
  let pairInfo: Awaited<ReturnType<typeof getPairInfo>> = null;
  let liveCandles: MarketCandle[] = [];
  let realSignal: RealMarketSignal | null = null;

  if (health.status === "ok" && quotexPair && !isAllowedMarketPair(quotexPair)) {
    marketStatus = "pair_not_found";
    marketDataSummary = `Pair **${quotexPair}** is not in the allowed market list.`;
  } else if (health.status === "ok" && quotexPair && isAllowedMarketPair(quotexPair)) {
    // Reject cross-market pair bleed (e.g. OTC symbol on Real tab)
    const pairIsOtc = quotexPair.toLowerCase().endsWith("_otc");
    if (isOtcMarket !== pairIsOtc) {
      marketStatus = "pair_not_found";
      marketDataSummary = isOtcMarket
        ? `Pair **${quotexPair}** is a REAL symbol — open Real Market Analyzer.`
        : `Pair **${quotexPair}** is an OTC symbol — open OTC Market Analyzer.`;
    } else {
    pairInfo = await getPairInfo(quotexPair);
    // Real needs ~50–90 bars for MACD/EMA50; OTC stays lean for speed.
    const candleData = await getRecentCandles(quotexPair, isOtcMarket ? 50 : 90);

    if (!pairInfo && !candleData) {
      marketStatus = "pair_not_found";
      marketDataSummary = `Pair **${quotexPair}** not found in live market database.`;
    } else if (!candleData?.candles?.length) {
      marketStatus = "no_candles";
      payoutPercent = pairInfo?.payout ?? candleData?.payout ?? null;
      marketDataSummary = `Pair **${quotexPair}** found but no candle history yet.`;
    } else {
      marketStatus = "ok";
      candlesUsed = candleData.candles.length;
      liveCandles = candleData.candles;
      payoutPercent = pairInfo?.payout ?? candleData.payout ?? null;

      if (
        candlesUsed < 8 &&
        pairInfo?.open !== undefined &&
        pairInfo.high !== undefined &&
        pairInfo.low !== undefined &&
        pairInfo.close !== undefined
      ) {
        intel = analyzeLiveSnapshotOHLC(
          {
            open: pairInfo.open,
            high: pairInfo.high,
            low: pairInfo.low,
            close: pairInfo.close,
          },
          { isOtc: isOtcMarket, payoutPercent }
        );
      } else {
        intel = analyzeMarketIntelligence(candleData.candles, {
          isOtc: isOtcMarket,
          payoutPercent,
        });
      }

      // REAL ONLY — never run on OTC analyzer
      if (!isOtcMarket) {
        realSignal = analyzeRealMarket(candleData.candles);
      }

      momentum = intel.momentum;
      nextDirection = intel.nextCandleDirection;
      marketDataSummary = [
        `### Live Quotex Fusion Feed (${preferred})`,
        `Pair: **${quotexPair}** | Payout: **${payoutPercent ? `${payoutPercent}%` : "N/A"}** | Candles: **${candlesUsed}**`,
        intel.summaryMarkdown,
        realSignal ? realSignal.summaryMarkdown : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    }
  }

  const snapshot =
    pairInfo?.open !== undefined &&
    pairInfo.high !== undefined &&
    pairInfo.low !== undefined &&
    pairInfo.close !== undefined
      ? {
          open: pairInfo.open,
          high: pairInfo.high,
          low: pairInfo.low,
          close: pairInfo.close,
        }
      : null;

  const { direction: fusedDirection, conflict: directionsConflict } =
    resolveFusedDirection(gemini, intel, candlesUsed, snapshot, isOtcMarket);

  let fusionConfidencePct = buildFusionConfidence(
    gemini,
    intel,
    marketStatus === "ok",
    payoutPercent,
    fusedDirection,
    candlesUsed,
    directionsConflict
  );

  let safeDirection = fusedDirection;

  if (isOtcMarket) {
    // OTC simple — wick/volume/LMP already in intel + setup
    safeDirection = fusedDirection;
    fusionConfidencePct = clampWinRate(fusionConfidencePct);
  } else if (realSignal) {
    // REAL ONLY — MACD/MA/Volume/Liquidity/Pattern/Wick/OrderFlow/OB
    const blended = blendRealMarketSignal(
      fusedDirection,
      fusionConfidencePct,
      realSignal
    );
    safeDirection = blended.direction;
    fusionConfidencePct = clampWinRate(blended.confidence);
  }

  const setup = await applyTradeSetupRules({
    isOtc: isOtcMarket,
    direction: safeDirection,
    confidence: fusionConfidencePct,
    candles: liveCandles,
    pair: quotexPair,
    intel,
  });
  // OTC setup is passthrough (classic labels only); Real may gate
  safeDirection = setup.direction;
  fusionConfidencePct = clampWinRate(setup.confidence);

  // Final Real refine after setup gates — REAL ONLY
  if (!isOtcMarket && realSignal && liveCandles.length >= 8) {
    const refined = blendRealMarketSignal(safeDirection, fusionConfidencePct, realSignal);
    if (realSignal.alignedCount >= 4) {
      safeDirection = refined.direction;
      fusionConfidencePct = clampWinRate(refined.confidence);
      if (refined.labels[0] && !setup.filters.includes(refined.labels[0])) {
        setup.filters = [refined.labels[0], ...setup.filters].slice(0, 5);
      }
      setup.note = "REAL · MACD+MA+Vol+Liq+Wick+OB+FVG";
    }
  }

  const recommendation = fuseRecommendation(
    gemini,
    intel,
    safeDirection,
    fusionConfidencePct,
    isOtcMarket
  );

  const kpiAlignment = alignKpiWithFusion(
    gemini,
    intel,
    safeDirection,
    fusionConfidencePct
  );

  const mergedText = mergeAnalysisText(
    gemini.analysisText,
    intel,
    safeDirection,
    fusionConfidencePct,
    quotexPair,
    payoutPercent,
    directionsConflict,
    setup
  );

  return {
    ...gemini,
    ...kpiAlignment,
    marketType: preferred,
    recommendation,
    winRatePct: fusionConfidencePct,
    winRateVal: `${fusionConfidencePct}% WIN RATE`,
    nextCandleDirection: safeDirection,
    fusionConfidencePct,
    fusionConfidenceVal: `${fusionConfidencePct}% WIN RATE`,
    quotexPair,
    payoutPercent,
    marketMomentum: momentum,
    marketDataSummary,
    setupMode: preferred,
    setupNote: setup.note,
    setupFilters: setup.filters,
    martingaleHint: isOtcMarket ? setup.martingaleHint : "none",
    analysisSources: {
      gemini: {
        model,
        status: geminiIsFallback ? "fallback" : "ok",
      },
      marketData: {
        status: marketStatus,
        apiUrl: marketApiUrl,
        pair: quotexPair,
        candlesUsed,
        payoutPercent,
      },
    },
    analysisText: mergedText,
  };
}

/** Real Market Analyzer entry — Real engine only. */
export function analyzeRealMarketChart(image: string): Promise<FusedAnalysisResult> {
  return analyzeWithFusion(image, { preferredMarket: "REAL" });
}

/** OTC Market Analyzer entry — OTC engine only. */
export function analyzeOtcMarketChart(image: string): Promise<FusedAnalysisResult> {
  return analyzeWithFusion(image, { preferredMarket: "OTC" });
}


