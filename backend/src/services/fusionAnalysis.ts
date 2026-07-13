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
} from "./marketDataClient.js";
import { isAllowedMarketPair } from "../config/allowedMarkets.js";

import {

  analyzeMarketIntelligence,

  analyzeLiveSnapshotOHLC,

  snapshotDirectionFromOHLC,

  type Bias,

  type Direction,

  type MarketIntelligence,

} from "./marketIntelligence.js";



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

  // Do not invent BUY/SELL from weak chart trend alone — that caused extra losses.
  if (direction === "SIDEWAYS" && intel?.nextCandleDirection && intel.nextCandleDirection !== "SIDEWAYS") {
    if (intel.confidencePct >= (isOtc ? 66 : 60)) {
      direction = intel.nextCandleDirection;
    }
  }



  const minConfidence = isOtc ? 66 : 60;

  const bullish = direction === "UP";
  const bearish = direction === "DOWN";

  const strong =
    fusionConfidence >= 80 &&
    direction !== "SIDEWAYS" &&
    Boolean(intel?.liquiditySweep.detected && intel?.oppositeCandleSignal.detected);

  // Simple gate: unclear / weak / conflict → HOLD (fewer losses than forced trades)
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



function applyOtcSafetyGate(

  isOtc: boolean,

  intel: MarketIntelligence | null,

  direction: Direction,

  confidence: number

): { direction: Direction; confidence: number } {

  if (!isOtc || !intel || direction === "SIDEWAYS") {

    return { direction, confidence };

  }



  let nextDirection = direction;

  let nextConfidence = confidence;

  const live = intel.nextCandleDirection;

  const insight = intel.otcInsight.toLowerCase();



  // OTC: follow live expansion / last-candle push — do not fight V-recoveries.
  if (insight.includes("bullish expansion")) {

    if (nextDirection === "DOWN") {

      return { direction: live === "UP" ? "UP" : "SIDEWAYS", confidence: Math.min(nextConfidence, live === "UP" ? 72 : 45) };

    }

    if (live === "UP") {

      nextDirection = "UP";

      nextConfidence = Math.max(nextConfidence, 70);

    }

  }

  if (insight.includes("bearish expansion")) {

    if (nextDirection === "UP") {

      return { direction: live === "DOWN" ? "DOWN" : "SIDEWAYS", confidence: Math.min(nextConfidence, live === "DOWN" ? 72 : 45) };

    }

    if (live === "DOWN") {

      nextDirection = "DOWN";

      nextConfidence = Math.max(nextConfidence, 70);

    }

  }



  // Live feed wins over chart-only SELL when momentum is already UP (common MTG loss case).
  if (nextDirection === "DOWN" && (intel.momentum === "BULLISH" || live === "UP")) {

    if (live === "UP" && intel.confidencePct >= 58) {

      return { direction: "UP", confidence: Math.max(62, Math.min(88, intel.confidencePct)) };

    }

    return { direction: "SIDEWAYS", confidence: Math.min(nextConfidence, 46) };

  }

  if (nextDirection === "UP" && (intel.momentum === "BEARISH" || live === "DOWN")) {

    if (live === "DOWN" && intel.confidencePct >= 58) {

      return { direction: "DOWN", confidence: Math.max(62, Math.min(88, intel.confidencePct)) };

    }

    return { direction: "SIDEWAYS", confidence: Math.min(nextConfidence, 46) };

  }



  if (

    live !== "SIDEWAYS" &&

    live !== nextDirection &&

    intel.confidencePct >= 62

  ) {

    return { direction: live, confidence: Math.max(60, Math.min(90, intel.confidencePct)) };

  }



  return { direction: nextDirection, confidence: nextConfidence };

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

  isOtc = false

): { direction: Direction; conflict: boolean } {

  const geminiDir = geminiTradeDirection(gemini);
  const thinData = candlesUsed < 8;

  // OTC: live market momentum first — chart trend alone caused many wrong SELL/MTG losses.
  if (isOtc && intel && intel.nextCandleDirection !== "SIDEWAYS" && intel.confidencePct >= 58) {
    if (geminiDir === "SIDEWAYS" || geminiDir === intel.nextCandleDirection) {
      return { direction: intel.nextCandleDirection, conflict: false };
    }
    if (intel.otcInsight.toLowerCase().includes("expansion")) {
      return { direction: intel.nextCandleDirection, conflict: true };
    }
    // Prefer live when confidence is clearly higher than chart win-rate guess.
    if (intel.confidencePct >= gemini.winRatePct + 4) {
      return { direction: intel.nextCandleDirection, conflict: true };
    }
  }

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

  directionsConflict = false

): string {

  const shortGemini = (geminiText || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, 140);

  if (!intel) {
    return `### Simple Signal\n* **${quotexPair}** → **${fusedDirection}** (${fusionConfidence}%)\n* ${shortGemini || "Chart-only read."}`;
  }

  return [
    "### Simple Signal",
    `* **Pair**: ${quotexPair}${payout ? ` · Payout ${payout}%` : ""}`,
    `* **Next candle**: **${fusedDirection}** · **${fusionConfidence}%**${directionsConflict ? " (conflict → careful)" : ""}`,
    `* **Live**: ${intel.momentum} · ${intel.nextCandleDirection}`,
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



export async function analyzeWithFusion(

  image: string

): Promise<FusedAnalysisResult> {

  const model = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";

  const health = await checkMarketDataHealth({ force: !isMarketDataReady() });

  const marketApiUrl =

    health.url || process.env.QUOTEX_MARKET_API_URL || "https://quotex-data-1n2b.onrender.com";

  if (health.status !== "ok") {

    throw Object.assign(new Error("Market data feed offline"), {

      code: "MARKET_DATA_OFFLINE",

    });

  }

  // Vision call only after market feed is confirmed (saves Gemini tokens on offline).
  const gemini = await analyzeChartImage(image);

  const geminiIsFallback = gemini.analysisText.includes("Simulation mode");



  const quotexPair = titleToQuotexPair(

    gemini.analysisTitle,

    gemini.marketType

  );



  let marketStatus: AnalysisSources["marketData"]["status"] = "offline";

  let candlesUsed = 0;

  let payoutPercent: number | null = null;

  let momentum: Bias = "NEUTRAL";

  let nextDirection: Direction = "SIDEWAYS";

  let marketDataSummary = "Quotex market data API is offline.";

  let intel: MarketIntelligence | null = null;

  let pairInfo: Awaited<ReturnType<typeof getPairInfo>> = null;



  if (health.status === "ok" && quotexPair && !isAllowedMarketPair(quotexPair)) {
    marketStatus = "pair_not_found";
    marketDataSummary = `Pair **${quotexPair}** is not in the allowed market list.`;
  } else if (health.status === "ok" && quotexPair && isAllowedMarketPair(quotexPair)) {

    pairInfo = await getPairInfo(quotexPair);

    const candleData = await getRecentCandles(quotexPair, 30);



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

      payoutPercent = pairInfo?.payout ?? candleData.payout ?? null;

      const isOtcMarket =
        gemini.marketType === "OTC" || quotexPair.endsWith("_otc");

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



      momentum = intel.momentum;

      nextDirection = intel.nextCandleDirection;

      marketDataSummary = [

        `### Live Quotex Fusion Feed`,

        `Pair: **${quotexPair}** | Payout: **${payoutPercent ? `${payoutPercent}%` : "N/A"}** | Candles: **${candlesUsed}**`,

        intel.summaryMarkdown,

      ].join("\n\n");

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

  const isOtcMarket =
    gemini.marketType === "OTC" || quotexPair.endsWith("_otc");

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

  const otcGate = applyOtcSafetyGate(isOtcMarket, intel, fusedDirection, fusionConfidencePct);
  const safeDirection = otcGate.direction;
  fusionConfidencePct = clampWinRate(otcGate.confidence);



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

    directionsConflict

  );



  return {

    ...gemini,

    ...kpiAlignment,

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


