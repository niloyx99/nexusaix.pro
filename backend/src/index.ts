import express from "express";
import cors from "cors";
import fs from "fs";
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
import { checkMarketDataHealth, startMarketDataPolling } from "./services/marketDataClient.js";
import { startChartAnalyticsResolver } from "./services/chartAnalytics.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { migrateJsonToMongoIfNeeded } from "./db/migrateFromJson.js";
import { loadMarketSnapshotCache } from "./services/marketSnapshotCache.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 7777;
const frontendDist = path.join(__dirname, "../../frontend/dist");
const frontendIndex = path.join(frontendDist, "index.html");
const hasFrontendBuild = fs.existsSync(frontendIndex);

function getAllowedOrigins(): string[] {
  return [
    process.env.FRONTEND_URL,
    process.env.ADMIN_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.BACKEND_URL,
    "http://localhost:7777",
    "http://127.0.0.1:7777",
    "http://localhost:8889",
    "http://127.0.0.1:8889",
    "http://localhost:8890",
    "http://127.0.0.1:8890",
  ].filter(Boolean) as string[];
}

function isAllowedOrigin(origin: string): boolean {
  const allowed = getAllowedOrigins();
  if (allowed.includes(origin)) return true;
  if (/^http:\/\/192\.168\.\d+\.\d+:(7777|8889|8890)$/.test(origin)) return true;
  try {
    const { hostname } = new URL(origin);
    if (hostname.endsWith(".onrender.com")) return true;
  } catch {
    return false;
  }
  return false;
}

async function startServer() {
  console.log(`Starting Aldi Bot backend (${isProduction ? "production" : "development"})...`);

  await connectMongo();
  console.log("MongoDB connected.");
  await migrateJsonToMongoIfNeeded();
  await loadMarketSnapshotCache();

  const app = express();
  app.set("trust proxy", 1);

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

  if (hasFrontendBuild) {
    app.use(
      express.static(frontendDist, {
        maxAge: isProduction ? "1h" : 0,
        index: false,
      })
    );
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(frontendIndex);
    });
  }

  app.use((req, res) => {
    res.status(404).json({
      success: false,
      status: "not_found",
      message: `Route ${req.method} ${req.originalUrl} does not exist.`,
      hint: "Try GET / or GET /api/health",
      timestamp: new Date().toISOString(),
    });
  });

  const server = app.listen(PORT, "0.0.0.0", () => {
    const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    console.log(`Backend running on ${publicUrl}`);
    if (hasFrontendBuild) {
      console.log(`Frontend UI served from ${publicUrl}`);
    } else {
      console.warn("Frontend build missing — run: npm run build --prefix frontend");
    }

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
