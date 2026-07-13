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
import newsRouter from "./routes/news.js";
import { checkMarketDataHealth, startMarketDataPolling } from "./services/marketDataClient.js";
import { startChartAnalyticsResolver } from "./services/chartAnalytics.js";
import { startNewsAnalysisScheduler, bootstrapNewsAnalysis } from "./services/newsBatch.js";
import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { migrateJsonToMongoIfNeeded } from "./db/migrateFromJson.js";
import { loadMarketSnapshotCache } from "./services/marketSnapshotCache.js";
import { getAllowedOrigins, isAllowedOrigin } from "./config/cors.js";
import { API_PREFIX, ADMIN_PATH } from "./config/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");

dotenv.config({ path: path.join(backendRoot, ".env") });
dotenv.config({ path: path.join(backendRoot, ".env.local"), override: true });

const isProduction = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 7777;

const frontendDist = path.join(__dirname, "../../frontend/dist");
const adminDist = path.join(__dirname, "../../admin/dist");
const publicDir = path.join(__dirname, "../public");
const frontendIndex = path.join(frontendDist, "index.html");
const adminIndex = path.join(adminDist, "index.html");
const landingPage = path.join(publicDir, "landing.html");
const hasFrontend = fs.existsSync(frontendIndex);
const hasAdmin = fs.existsSync(adminIndex);
const hasLanding = fs.existsSync(landingPage);

function sendSpa(indexFile: string) {
  return (_req: express.Request, res: express.Response) => {
    res.sendFile(indexFile);
  };
}

function mountApiRoutes(app: express.Application): void {
  app.use(`${API_PREFIX}/licenses`, licensesRouter);
  app.use(`${API_PREFIX}/admin/licenses`, adminLicensesRouter);
  app.use(`${API_PREFIX}/analyze`, analyzeRouter);
  app.use(`${API_PREFIX}/market-data`, marketDataRouter);
  app.use(`${API_PREFIX}/signals`, signalsRouter);
  app.use(`${API_PREFIX}/analytics`, analyticsRouter);
  app.use(`${API_PREFIX}/news`, newsRouter);

  // Legacy /api/* aliases (local tools, older clients)
  app.use("/api/licenses", licensesRouter);
  app.use("/api/admin/licenses", adminLicensesRouter);
  app.use("/api/analyze", analyzeRouter);
  app.use("/api/market-data", marketDataRouter);
  app.use("/api/signals", signalsRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/news", newsRouter);
}

async function startServer() {
  console.log(`Starting Nexus AI (${isProduction ? "production" : "development"})...`);

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
  console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin / server-to-server requests have no Origin header
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
        "X-Requested-With",
      ],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 86400,
    })
  );

  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));

  // Public health for Render / load balancers (obfuscated pulse stays on statusRouter)
  app.get("/health", (_req, res) => {
    res.status(200).json({
      success: true,
      status: "healthy",
      service: "nexus-ai",
      timestamp: new Date().toISOString(),
    });
  });

  app.use(statusRouter);
  mountApiRoutes(app);

  if (hasLanding) {
    app.use(
      express.static(publicDir, {
        maxAge: isProduction ? "1h" : 0,
        index: false,
      })
    );
    app.get("/", (_req, res) => {
      res.sendFile(landingPage);
    });
  }

  if (hasAdmin) {
    const adminStatic = express.static(adminDist, {
      maxAge: isProduction ? "7d" : 0,
      index: false,
      redirect: false,
      fallthrough: true,
    });
    app.use(ADMIN_PATH, adminStatic);
    app.use(`${ADMIN_PATH}/`, adminStatic);
    const serveAdminSpa = sendSpa(adminIndex);
    app.get([ADMIN_PATH, `${ADMIN_PATH}/`], serveAdminSpa);
    app.get(new RegExp(`^${ADMIN_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/.+`), serveAdminSpa);
  }

  if (hasFrontend) {
    const frontendStatic = express.static(frontendDist, {
      maxAge: isProduction ? "7d" : 0,
      index: false,
      redirect: false,
      fallthrough: true,
    });

    app.use("/app", frontendStatic);
    app.use("/app/", frontendStatic);

    const serveFrontendSpa = sendSpa(frontendIndex);
    app.get(["/app", "/app/"], serveFrontendSpa);
    app.get(/^\/app\/.+/, serveFrontendSpa);
  }

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
    console.log(`Server: ${publicUrl}`);
    console.log(`Frontend: ${hasFrontend ? "enabled at /app" : "missing (use npm run dev in frontend/)"}`);
    console.log(`Landing: ${hasLanding ? "enabled at /" : "missing"}`);
    console.log(`Admin: ${hasAdmin ? `enabled at ${ADMIN_PATH}` : "missing"}`);
    console.log(`API prefix: ${API_PREFIX}`);

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
