import { Router } from "express";
import { analyzeWithFusion } from "../services/fusionAnalysis.js";
import { getLicenseKeyFromRequest, requireValidatedLicense } from "./licenses.js";
import { recordChartAnalysisSignal } from "../services/chartAnalytics.js";
import { checkMarketDataHealth, isMarketDataReady } from "../services/marketDataClient.js";
import { incrementUsage } from "../services/licenseStore.js";
import type { AnalysisSources } from "../services/fusionAnalysis.js";

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
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image data provided" });
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

    const result = await analyzeWithFusion(image);

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
