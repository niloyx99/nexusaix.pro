import { Router } from "express";
import { quotexMarket } from "../services/quotex/index.js";

const router = Router();

router.get("/status", (_req, res) => {
  res.json({
    success: true,
    data: quotexMarket.getStatus(),
  });
});

router.get("/markets", (_req, res) => {
  const data = quotexMarket.getMarkets();
  res.json({
    success: true,
    data,
  });
});

router.get("/markets/:marketType", (req, res) => {
  const type = req.params.marketType.toUpperCase();
  if (type !== "REAL" && type !== "OTC") {
    return res.status(400).json({
      success: false,
      error: "marketType must be REAL or OTC",
    });
  }

  return res.json({
    success: true,
    data: {
      source: "quotex",
      marketType: type,
      assets: quotexMarket.listAssets(type as "REAL" | "OTC"),
    },
  });
});

router.get("/asset/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const asset = quotexMarket.getAsset(symbol);
    if (!asset) {
      return res.status(404).json({
        success: false,
        error: `Asset ${symbol} not found`,
      });
    }

    const period = Number(req.query.period) || 60;
    const snapshot = await quotexMarket.getMarketSnapshot(symbol, period);

    return res.json({
      success: true,
      data: {
        asset,
        snapshot,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quotex asset error";
    return res.status(500).json({ success: false, error: message });
  }
});

router.post("/connect", async (req, res) => {
  try {
    const forceLogin = Boolean(req.body?.forceLogin);
    const data = await quotexMarket.initialize(forceLogin);
    return res.json({ success: true, data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Quotex connection failed";
    return res.status(500).json({ success: false, error: message });
  }
});

export default router;
