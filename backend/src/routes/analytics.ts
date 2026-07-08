import { Router } from "express";
import { getLicenseKeyFromRequest } from "./licenses.js";
import {
  getChartAnalyticsForLicense,
  resolvePendingChartSignals,
} from "../services/chartAnalytics.js";

const router = Router();

router.get("/chart", async (req, res) => {
  try {
    const licenseKey = getLicenseKeyFromRequest(req);
    if (!licenseKey) {
      return res.status(401).json({ error: "License key required." });
    }

    await resolvePendingChartSignals();
    const analytics = await getChartAnalyticsForLicense(licenseKey);

    return res.json({
      success: true,
      data: analytics,
    });
  } catch (error: unknown) {
    console.error("Chart analytics error:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to load chart analytics.",
    });
  }
});

export default router;
