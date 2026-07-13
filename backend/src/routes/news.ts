import { Router } from "express";
import { fetchDailyForexNews } from "../services/forexNewsClient.js";
import { attachCachedAnalyses } from "../services/newsBatch.js";
import { getCachedAnalysis } from "../services/newsAnalysis.js";
import { findForexNewsEvent } from "../services/forexNewsClient.js";
import { requireActiveLicense } from "./licenses.js";

const router = Router();

router.get("/daily", (req, res, next) => {
  void requireActiveLicense(req, res, next, 1);
}, async (_req, res) => {
  try {
    const data = await fetchDailyForexNews();
    const events = attachCachedAnalyses(data.events);

    const analyzed = events.filter((e) => e.analysis !== null).length;

    return res.json({
      success: true,
      data: {
        events,
        calendarDate: data.calendarDate,
        timezoneLabel: data.timezoneLabel,
        total: events.length,
        analyzed,
        autoAnalyzed: true,
        impactFilter: "high",
        source:
          process.env.FOREX_NEWS_API_URL ||
          "https://forexfactoryscrapper-main.onrender.com",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load news";
    return res.status(503).json({ success: false, error: message });
  }
});

router.get("/analyze/:id", (req, res, next) => {
  void requireActiveLicense(req, res, next, 1);
}, async (req, res) => {
  try {
    const eventId = String(req.params.id ?? "").trim();
    if (!eventId) {
      return res.status(400).json({ success: false, error: "Event id is required" });
    }

    const calendarDate =
      typeof req.query.date === "string" ? req.query.date : undefined;

    const event = await findForexNewsEvent(eventId, calendarDate);
    if (!event) {
      return res.status(404).json({ success: false, error: "News event not found" });
    }

    const analysis = getCachedAnalysis(event)?.data ?? null;
    if (!analysis) {
      return res.status(404).json({
        success: false,
        error: "Analysis not ready yet — background scheduler will process this event.",
      });
    }

    return res.json({
      success: true,
      data: { event, analysis },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
