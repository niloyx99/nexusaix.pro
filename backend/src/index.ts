import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import analyzeRouter from "./routes/analyze.js";
import statusRouter from "./routes/status.js";
import marketDataRouter from "./routes/marketData.js";
import signalsRouter from "./routes/signals.js";
import licensesRouter from "./routes/licenses.js";
import adminLicensesRouter from "./routes/adminLicenses.js";
import analyticsRouter from "./routes/analytics.js";
import newsRouter from "./routes/news.js";
import { checkMarketDataHealth, startMarketDataPolling } from "./services/marketDataClient.js";
import { startChartAnalyticsResolver } from "./services/chartAnalytics.js";
import { startNewsAnalysisScheduler, bootstrapNewsAnalysis } from "./services/newsBatch.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { migrateJsonToMongoIfNeeded } from "./db/migrateFromJson.js";
import { loadMarketSnapshotCache } from "./services/marketSnapshotCache.js";
import { getAllowedOrigins, isAllowedOrigin } from "./config/cors.js";
import { API_PREFIX } from "./config/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");

dotenv.config({ path: path.join(backendRoot, ".env") });

const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 7777;

function mountApiRoutes(app: express.Application): void {
  app.use(`${API_PREFIX}/licenses`, licensesRouter);
  app.use(`${API_PREFIX}/admin/licenses`, adminLicensesRouter);
  app.use(`${API_PREFIX}/analyze`, analyzeRouter);
  app.use(`${API_PREFIX}/market-data`, marketDataRouter);
  app.use(`${API_PREFIX}/signals`, signalsRouter);
  app.use(`${API_PREFIX}/analytics`, analyticsRouter);
  app.use(`${API_PREFIX}/news`, newsRouter);
}

async function startServer() {
  console.log(`Starting Nexus AI API (${isProduction ? "production" : "development"})...`);

  try {
    await connectMongo();
    console.log("MongoDB connected.");
    await migrateJsonToMongoIfNeeded();
  } catch (error) {
    console.error("MongoDB unavailable — API will start, DB-backed routes may fail.", error);
  }

  try {
    await loadMarketSnapshotCache();
  } catch (error) {
    console.warn("Market snapshot cache failed to load:", error);
  }

  const app = express();
  app.set("trust proxy", 1);

  const allowedOrigins = getAllowedOrigins();
  console.log(`CORS allowed origins: ${allowedOrigins.join(", ") || "(none — set FRONTEND_URL / ADMIN_URL)"}`);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (isAllowedOrigin(origin)) return callback(null, true);
        if (!isProduction) {
          console.warn(`CORS allowing unknown origin in development: ${origin}`);
          return callback(null, true);
        }
        console.warn(`CORS blocked origin: ${origin}`);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-License-Key",
        "X-Device-Fingerprint",
        "X-Admin-Password",
        "X-Requested-With",
      ],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 86400,
    })
  );

  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));

  app.get("/health", (_req, res) => {
    res.status(200).json({
      success: true,
      status: "healthy",
      service: "nexus-ai",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", (_req, res) => {
    res.status(200).json({
      success: true,
      service: "nexus-ai",
      mode: "api-only",
      health: "/health",
      api: {
        health: `${API_PREFIX}/health`,
        licenses: `${API_PREFIX}/licenses`,
        adminLicenses: `${API_PREFIX}/admin/licenses`,
        analyze: `${API_PREFIX}/analyze`,
        marketData: `${API_PREFIX}/market-data`,
        signals: `${API_PREFIX}/signals`,
        analytics: `${API_PREFIX}/analytics`,
        news: `${API_PREFIX}/news`,
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.use(statusRouter);
  mountApiRoutes(app);

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      status: "not_found",
      message: `Route ${req.method} ${req.originalUrl} does not exist.`,
      timestamp: new Date().toISOString(),
    });
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    const publicUrl =
      process.env.BACKEND_URL?.split(",")[0]?.trim() ||
      process.env.RENDER_EXTERNAL_URL ||
      `http://localhost:${PORT}`;
    console.log(`API: ${publicUrl}`);
    console.log(`Health: ${publicUrl}/health`);
    console.log(`Routes under ${API_PREFIX}/*`);

    checkMarketDataHealth().then((health) => {
      if (health.status === "ok") {
        console.log(
          `Market data API connected: ${health.url} (${health.active_pairs ?? health.total_pairs ?? 0} pairs)`
        );
      } else {
        console.warn(`Market data API offline at ${health.url} — check QUOTEX_MARKET_API_URL`);
      }
    });
  });

  const stopPolling = startMarketDataPolling(30_000);
  const stopAnalytics = startChartAnalyticsResolver(15_000);

  void bootstrapNewsAnalysis().catch((err) => {
    console.warn("News analysis bootstrap failed:", err);
  });
  const stopNews = startNewsAnalysisScheduler(5 * 60_000);

  const shutdown = async (signal: string) => {
    console.log(`${signal} received — shutting down...`);
    stopPolling();
    stopAnalytics();
    stopNews();
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
