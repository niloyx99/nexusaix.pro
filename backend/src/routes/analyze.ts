import { Router } from "express";
import {
  analyzeOtcMarketChart,
  analyzeRealMarketChart,
} from "../analysis/fusionAnalysis.js";
import { getLicenseKeyFromRequest, requireValidatedLicense } from "./licenses.js";
import { recordChartAnalysisSignal } from "../market/chartAnalytics.js";
import { checkMarketDataHealth, isMarketDataReady } from "../market/marketDataClient.js";
import { incrementUsage } from "../license/licenseStore.js";
import type { AnalysisSources } from "../analysis/fusionAnalysis.js";

const router = Router();

function marketFailureReason(
  status: AnalysisSources["marketData"]["status"],
  pair?: string
): string {
  switch (status) {
    case "offline":
      return "Market data feed offline — analysis was not run to save your scan.";
    case "pair_not_found":
      return pair
        ? `Market pair "${pair}" not found — use a supported Quotex chart symbol.`
        : "Chart pair not found in the live market database.";
    case "no_candles":
      return pair
        ? `No live candles for "${pair}" yet — wait a moment and try again.`
        : "No candle history available for this pair.";
    default:
      return "Market data not connected";
  }
}

router.post("/", (req, res, next) => {
  void requireValidatedLicense(req, res, next);
}, async (req, res) => {
  try {
    const { image, marketMode } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image data provided" });
    }

    const preferredMarket =
      marketMode === "real" || marketMode === "REAL"
        ? ("REAL" as const)
        : marketMode === "otc" || marketMode === "OTC"
          ? ("OTC" as const)
          : null;

    if (!preferredMarket) {
      return res.status(400).json({
        error: "marketMode required",
        message: 'Send marketMode: "real" or "otc". Analyzers are hard-separated.',
        code: "INVALID_MARKET_MODE",
      });
    }

    // Fast path: background polling keeps cache warm — skip slow health round-trip.
    if (!isMarketDataReady()) {
      const health = await checkMarketDataHealth();
      if (health.status !== "ok") {
        return res.status(503).json({
          error: "Market data offline",
          message: "Market data is not available. Screenshot analysis requires a live market feed.",
          failures: [marketFailureReason("offline")],
          code: "MARKET_DATA_OFFLINE",
          geminiConnected: false,
          marketDataConnected: false,
        });
      }
    }

    // Hard split: Real and OTC never share an entry path
    const result =
      preferredMarket === "REAL"
        ? await analyzeRealMarketChart(image)
        : await analyzeOtcMarketChart(image);

    const geminiConnected = result.analysisSources.gemini.status === "ok";
    const marketDataConnected = result.analysisSources.marketData.status === "ok";

    if (!geminiConnected || !marketDataConnected) {
      const failures: string[] = [];
      if (!geminiConnected) failures.push("AI analysis unavailable — check server configuration.");
      if (!marketDataConnected) {
        failures.push(
          marketFailureReason(
            result.analysisSources.marketData.status,
            result.quotexPair || result.analysisSources.marketData.pair
          )
        );
      }

      return res.status(503).json({
        error: "Analysis failed",
        message: failures[0] ?? "Analysis Failed",
        failures,
        code: !marketDataConnected ? "MARKET_DATA_UNAVAILABLE" : "AI_UNAVAILABLE",
        geminiConnected,
        marketDataConnected,
      });
    }

    const licenseKey = getLicenseKeyFromRequest(req);
    if (licenseKey) {
      await incrementUsage(licenseKey, 1);
    }

    const license = res.locals.license as { key: string } | undefined;
    if (license?.key) {
      void recordChartAnalysisSignal(license.key, result).catch((err) => {
        console.warn("Chart analytics record failed:", err);
      });
    }

    return res.json(result);
  } catch (error: unknown) {
    console.error("Analyze API error:", error);
    const details =
      error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      error: "Failed to analyze screenshot",
      details,
    });
  }
});

export default router;
