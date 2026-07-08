import { Router } from "express";
import { analyzeWithFusion } from "../services/fusionAnalysis.js";
import { requireActiveLicense } from "./licenses.js";
import { recordChartAnalysisSignal } from "../services/chartAnalytics.js";

const router = Router();

router.post("/", (req, res, next) => {
  void requireActiveLicense(req, res, next, 1);
}, async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "No image data provided" });
    }

    const result = await analyzeWithFusion(image);

    const geminiConnected = result.analysisSources.gemini.status === "ok";
    const marketDataConnected = result.analysisSources.marketData.status === "ok";

    if (!geminiConnected || !marketDataConnected) {
      const failures: string[] = [];
      if (!geminiConnected) failures.push("Gemini not connected");
      if (!marketDataConnected) failures.push("Market data not connected");

      return res.status(503).json({
        error: "Analysis failed",
        message: "Analysis Failed",
        failures,
        geminiConnected,
        marketDataConnected,
      });
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
