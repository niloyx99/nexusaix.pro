import { Router } from "express";
import { checkMarketDataHealth } from "../services/marketDataClient.js";
import { isMongoConnected } from "../db/mongo.js";
import { HEALTH_PATH } from "../config/paths.js";

const VERSION = "1.0.0";

const router = Router();

router.get(HEALTH_PATH, async (_req, res) => {
  const market = await checkMarketDataHealth();
  res.status(200).json({
    success: true,
    status: "healthy",
    service: "nexus-ai",
    version: VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: {
      api: "ok",
      mongodb: isMongoConnected() ? "connected" : "disconnected",
      ai: process.env.OPENROUTER_API_KEY ? "ready" : "unavailable",
      marketData: market.status === "ok" ? "connected" : "offline",
    },
  });
});

export default router;
