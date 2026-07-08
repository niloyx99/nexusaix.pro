import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import analyzeRouter from "./routes/analyze.js";
import statusRouter from "./routes/status.js";
import marketDataRouter from "./routes/marketData.js";
import signalsRouter from "./routes/signals.js";
import licensesRouter from "./routes/licenses.js";
import adminLicensesRouter from "./routes/adminLicenses.js";
import analyticsRouter from "./routes/analytics.js";
import { checkMarketDataHealth, startMarketDataPolling } from "./services/marketDataClient.js";
import { startChartAnalyticsResolver } from "./services/chartAnalytics.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { migrateJsonToMongoIfNeeded } from "./db/migrateFromJson.js";
import { loadMarketSnapshotCache } from "./services/marketSnapshotCache.js";
import { getAllowedOrigins, isAllowedOrigin } from "./config/cors.js";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 7777;

async function startServer() {
  console.log(`Starting Nexus AI API (${isProduction ? "production" : "development"})...`);

  await connectMongo();
  console.log("MongoDB connected.");
  await migrateJsonToMongoIfNeeded();
  await loadMarketSnapshotCache();

  const app = express();
  app.set("trust proxy", 1);

  const allowedOrigins = getAllowedOrigins();
  console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || isAllowedOrigin(origin)) {
          return callback(null, true);
        }
        if (!isProduction) return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));

  app.use(statusRouter);
  app.use("/api/licenses", licensesRouter);
  app.use("/api/admin/licenses", adminLicensesRouter);
  app.use("/api/analyze", analyzeRouter);
  app.use("/api/market-data", marketDataRouter);
  app.use("/api/signals", signalsRouter);
  app.use("/api/analytics", analyticsRouter);

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      status: "not_found",
      message: `Route ${req.method} ${req.originalUrl} does not exist.`,
      hint: "API only — try GET /api/health",
      timestamp: new Date().toISOString(),
    });
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    const publicUrl = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`API server: ${publicUrl}`);
    console.log("Mode: API-only (frontend & admin hosted separately)");

    checkMarketDataHealth().then((health) => {
      if (health.status === "ok") {
        console.log(
          `Market data API connected: ${health.url} (${health.active_pairs ?? health.total_pairs ?? 0} pairs)`
        );
      } else {
        console.warn(
          `Market data API offline at ${health.url} — check QUOTEX_MARKET_API_URL`
        );
      }
    });
  });

  const stopPolling = startMarketDataPolling(30_000);
  const stopAnalytics = startChartAnalyticsResolver(10_000);

  const shutdown = async (signal: string) => {
    console.log(`${signal} received — shutting down...`);
    stopPolling();
    stopAnalytics();
    server.close();
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
