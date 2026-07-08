import { Router } from "express";
import {
  checkMarketDataHealth,
  getMarketApiUrl,
} from "../services/marketDataClient.js";

const router = Router();

router.get("/status", async (_req, res) => {
  const health = await checkMarketDataHealth();
  res.json({
    success: health.status === "ok",
    data: {
      ...health,
      message:
        health.status === "ok"
          ? "Market data API connected"
          : "Market data API offline — check QUOTEX_MARKET_API_URL",
    },
  });
});

router.get("/", (_req, res) => {
  res.json({
    success: true,
    apiUrl: getMarketApiUrl(),
    endpoints: ["/api/market-data/status"],
  });
});

export default router;
