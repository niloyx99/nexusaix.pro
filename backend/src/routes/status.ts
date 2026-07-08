import { Router } from "express";
import { checkMarketDataHealth } from "../services/marketDataClient.js";
import { isMongoConnected } from "../db/mongo.js";

const STARTED_AT = new Date().toISOString();
const VERSION = "1.0.0";

const ENDPOINTS = {
  health: { method: "GET", path: "/api/health", description: "Service health check" },
  analyze: {
    method: "POST",
    path: "/api/analyze",
    description: "Fusion analyze: Gemini vision + live market data",
    body: { image: "base64 or data URL string" },
  },
  marketDataStatus: {
    method: "GET",
    path: "/api/market-data/status",
    description: "Quotex market data API connection",
  },
};

function apiPayload() {
  return {
    success: true,
    service: "Aldi Bot API",
    status: "running",
    version: VERSION,
    message: "Backend is live and ready to accept requests.",
    uptime: process.uptime(),
    startedAt: STARTED_AT,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    endpoints: ENDPOINTS,
  };
}

const router = Router();

router.get("/api", (_req, res) => {
  res.status(200).json({
    ...apiPayload(),
    documentation: "Send POST /api/analyze with { image: '<base64>' } for chart analysis.",
  });
});

router.get("/api/health", async (_req, res) => {
  const market = await checkMarketDataHealth();
  res.status(200).json({
    success: true,
    status: "healthy",
    service: "aldi-bot-backend",
    version: VERSION,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks: {
      api: "ok",
      mongodb: isMongoConnected() ? "connected" : "disconnected",
      openrouter: process.env.OPENROUTER_API_KEY ? "configured" : "missing_key",
      marketData: market.status,
      marketDataUrl: market.url,
    },
  });
});

export default router;
