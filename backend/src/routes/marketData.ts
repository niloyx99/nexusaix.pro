import { Router } from "express";
import { checkMarketDataHealth } from "../market/marketDataClient.js";
import { API_PREFIX } from "../config/paths.js";

const router = Router();

router.get("/status", async (_req, res) => {
  const health = await checkMarketDataHealth();
  res.json({
    success: health.status === "ok",
    data: {
      status: health.status,
      total_pairs: health.total_pairs,
      active_pairs: health.active_pairs,
      last_update: health.last_update,
      message:
        health.status === "ok"
          ? "Market data feed connected"
          : "Market data feed offline",
    },
  });
});

router.get("/", (_req, res) => {
  res.json({
    success: true,
    endpoints: [`${API_PREFIX}/market-data/status`],
  });
});

export default router;
