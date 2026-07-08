import {

  analyzeChartImage,

  type AnalysisResult,

} from "./openrouter.js";

import {

  checkMarketDataHealth,

  getPairInfo,

  getRecentCandles,

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

  fusionConfidence: number

): AnalysisResult["recommendation"] {

  const bullish =

    fusedDirection === "UP" ||

    (gemini.trend === "BULLISH" && fusedDirection !== "DOWN");

  const bearish =

    fusedDirection === "DOWN" ||

    (gemini.trend === "BEARISH" && fusedDirection !== "UP");



  const strong =

    fusionConfidence >= 82 &&

    fusedDirection !== "SIDEWAYS" &&

    (intel?.liquiditySweep.detected || intel?.oppositeCandleSignal.detected || gemini.recommendation.includes("STRONG"));



  if (fusedDirection === "SIDEWAYS" || fusionConfidence < 62) {

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

  let score = thinData
    ? gemini.winRatePct * 0.72
    : gemini.winRatePct * 0.42;



  if (marketOk && intel) {

    score += thinData
      ? intel.confidencePct * 0.18
      : intel.confidencePct * 0.38;



    if (directionsAlign(geminiDir, intel.nextCandleDirection)) score += thinData ? 12 : 14;

    if (directionsAlign(geminiDir, fusedDirection)) score += 8;

    if (directionsAlign(intel.nextCandleDirection, fusedDirection)) score += thinData ? 6 : 10;



    if (

      (gemini.trend === "BULLISH" && intel.momentum === "BULLISH") ||

      (gemini.trend === "BEARISH" && intel.momentum === "BEARISH")

    ) {

      score += 6;

    } else if (intel.momentum === "NEUTRAL") {

      score += 1;

    } else if (!thinData) {

      score -= 14;

    }



    if (intel.liquiditySweep.detected) score += thinData ? 5 : 8;

    if (intel.oppositeCandleSignal.detected) score += thinData ? 5 : 7;

    if (intel.liquiditySweep.detected && intel.oppositeCandleSignal.detected) score += 8;

    if (intel.mmxm.phase === "MANIPULATION") score += 5;

    if (intel.priceAction.rejection) score += 4;

    if (intel.msnr.signal !== "NONE") score += 3;

  } else if (!thinData) {

    score -= 12;

  }



  if (directionsConflict) score -= 22;

  if (fusedDirection === "SIDEWAYS") score = Math.min(score, 58);

  if (gemini.recommendation === "HOLD") score = Math.min(score, 62);



  if (payout && payout >= 80) score += 3;

  if (payout && payout > 0 && payout < 55) score -= 8;



  return clamp(score);

}



function resolveFusedDirection(

  gemini: AnalysisResult,

  intel: MarketIntelligence | null,

  candlesUsed: number,

  snapshot?: { open: number; high: number; low: number; close: number } | null

): { direction: Direction; conflict: boolean } {

  const geminiDir = geminiTradeDirection(gemini);
  const thinData = candlesUsed < 8;

  if (gemini.recommendation === "HOLD" || geminiDir === "SIDEWAYS") {
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

  if (!intel) return geminiText;



  const fusionSection = [

    "### Fusion Verdict (Gemini + Live Quotex Data)",

    `* **Pair**: ${quotexPair} | **Payout**: ${payout ? `${payout}%` : "N/A"}`,

    `* **Next candle direction**: **${fusedDirection}**`,

    `* **Fusion confidence**: **${fusionConfidence}%**${directionsConflict ? " *(chart vs live conflict — reduced)*" : ""}`,

    `* **SMC liquidity**: ${intel.liquiditySweep.detected ? intel.liquiditySweep.type.replace("_", " ") : "No sweep"} — ${intel.liquiditySweep.description}`,

    `* **MMXM**: ${intel.mmxm.model !== "NONE" ? intel.mmxm.model : "Scanning"} (${intel.mmxm.phase}) — ${intel.mmxm.description}`,

    `* **MSNR (Malaysian SNR)**: ${intel.msnr.signal} — ${intel.msnr.description}`,

    `* **Price action**: ${intel.priceAction.pattern} — ${intel.priceAction.description}`,

    `* **Opposite-candle reversal**: ${intel.oppositeCandleSignal.detected ? `YES → **${intel.oppositeCandleSignal.nextBias}**` : "No"} — ${intel.oppositeCandleSignal.description}`,

    `* **OTC insight**: ${intel.otcInsight}`,

  ].join("\n");



  return `${geminiText}\n\n${fusionSection}\n\n${intel.summaryMarkdown}`;

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

  const gemini = await analyzeChartImage(image);

  const geminiIsFallback = gemini.analysisText.includes("Simulation mode");



  const quotexPair = titleToQuotexPair(

    gemini.analysisTitle,

    gemini.marketType

  );



  const health = await checkMarketDataHealth();

  const marketApiUrl =

    health.url || process.env.QUOTEX_MARKET_API_URL || "https://quotex-data-1n2b.onrender.com";



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

    const candleData = await getRecentCandles(quotexPair, 60);



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

  const { direction: fusedDirection, conflict: directionsConflict } =
    resolveFusedDirection(gemini, intel, candlesUsed, snapshot);

  const fusionConfidencePct = buildFusionConfidence(

    gemini,

    intel,

    marketStatus === "ok",

    payoutPercent,

    fusedDirection,

    candlesUsed,

    directionsConflict

  );



  const recommendation = fuseRecommendation(

    gemini,

    intel,

    fusedDirection,

    fusionConfidencePct

  );



  const kpiAlignment = alignKpiWithFusion(

    gemini,

    intel,

    fusedDirection,

    fusionConfidencePct

  );



  const mergedText = mergeAnalysisText(

    gemini.analysisText,

    intel,

    fusedDirection,

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

    nextCandleDirection: fusedDirection,

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


