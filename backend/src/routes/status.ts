import { Router } from "express";
import { checkMarketDataHealth } from "../market/marketDataClient.js";
import { isMongoConnected } from "../db/mongo.js";
import { HEALTH_PATH, LEGACY_API_PREFIX, API_PREFIX_DOT } from "../config/paths.js";

const VERSION = "1.0.0";

const router = Router();

async function healthHandler(_req: import("express").Request, res: import("express").Response) {
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
}

router.get(HEALTH_PATH, healthHandler);
router.get(`${API_PREFIX_DOT}/health`, healthHandler);
router.get(`${LEGACY_API_PREFIX}/health`, healthHandler);
export default router;
