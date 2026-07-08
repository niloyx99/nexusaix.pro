import { Router } from "express";
import { generateFutureSignals } from "../services/futureSignals.js";
import { checkFutureSignalsText } from "../services/signalChecker.js";
import { requireActiveLicense } from "./licenses.js";

const router = Router();

const VALID_COUNTS = [5, 10, 15, 20] as const;

router.post("/generate", (req, res, next) => {
  const rawCount = Number(req.body?.count);
  const count = VALID_COUNTS.includes(rawCount as (typeof VALID_COUNTS)[number])
    ? (rawCount as (typeof VALID_COUNTS)[number])
    : 5;
  void requireActiveLicense(req, res, next, count);
}, async (req, res) => {
  try {
    const marketType = req.body?.marketType === "OTC" ? "OTC" : "REAL";
    const rawCount = Number(req.body?.count);
    const count = VALID_COUNTS.includes(rawCount as (typeof VALID_COUNTS)[number])
      ? (rawCount as (typeof VALID_COUNTS)[number])
      : 5;

    const result = await generateFutureSignals({ marketType, count });

    if (!result.success) {
      return res.status(503).json({
        success: false,
        error: result.message || "Signal generation failed",
        failures: result.message ? [result.message] : ["Signal generation failed"],
        data: result,
      });
    }

    return res.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    console.error("Signals API error:", error);
    const details = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      success: false,
      error: "Failed to generate signals",
      details,
    });
  }
});

router.post("/check", (req, res, next) => {
  void requireActiveLicense(req, res, next, 1);
}, async (req, res) => {
  try {
    const text = String(req.body?.text ?? "");
    if (!text.trim()) {
      return res.status(400).json({
        success: false,
        error: "Paste signal text to check.",
      });
    }

    const result = await checkFutureSignalsText(text);
    return res.json({ success: true, data: result });
  } catch (error: unknown) {
    console.error("Signal check error:", error);
    const details = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({
      success: false,
      error: "Failed to check signals",
      details,
    });
  }
});

export default router;
