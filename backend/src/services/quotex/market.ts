import { QuotexClient } from "./client.js";
import { getOrCreateQuotexSession, loginToQuotex } from "./auth.js";
import {
  QUOTEX_IS_DEMO,
  getQuotexCredentials,
  hasQuotexCredentials,
} from "./config.js";
import type {
  QuotexAsset,
  QuotexCandle,
  QuotexConnectionStatus,
  QuotexMarketSnapshot,
  QuotexStatus,
} from "./types.js";

class QuotexMarketService {
  private client: QuotexClient | null = null;
  private status: QuotexConnectionStatus = "disconnected";
  private message = "Quotex market data is not connected";
  private error: string | undefined;
  private lastSync: string | undefined;
  private assets: QuotexAsset[] = [];
  private quotes = new Map<string, number>();
  private initializing: Promise<void> | null = null;

  getStatus(): QuotexStatus {
    const otc = this.assets.filter((a) => a.marketType === "OTC");
    const real = this.assets.filter((a) => a.marketType === "REAL");

    return {
      status: this.status,
      message: this.message,
      isDemo: QUOTEX_IS_DEMO,
      emailConfigured: hasQuotexCredentials(),
      assets: {
        otc: otc.length,
        real: real.length,
        total: this.assets.length,
      },
      lastSync: this.lastSync,
      error: this.error,
    };
  }

  getMarkets() {
    const otc = this.assets.filter((a) => a.marketType === "OTC");
    const real = this.assets.filter((a) => a.marketType === "REAL");
    return {
      source: "quotex",
      updatedAt: this.lastSync,
      otc,
      real,
    };
  }

  getAsset(symbol: string): QuotexAsset | undefined {
    const normalized = symbol.toUpperCase();
    return this.assets.find(
      (asset) => asset.symbol.toUpperCase() === normalized
    );
  }

  getQuote(symbol: string): number | undefined {
    return this.quotes.get(symbol.toUpperCase());
  }

  async initialize(forceLogin = false): Promise<QuotexStatus> {
    if (!hasQuotexCredentials()) {
      this.status = "error";
      this.message = "Quotex credentials missing in backend/.env";
      this.error = "Set QUOTEX_EMAIL and QUOTEX_PASSWORD";
      return this.getStatus();
    }

    if (this.initializing) {
      await this.initializing;
      return this.getStatus();
    }

    this.initializing = this.connectInternal(forceLogin).finally(() => {
      this.initializing = null;
    });

    await this.initializing;
    return this.getStatus();
  }

  private async connectInternal(forceLogin: boolean) {
    this.status = "connecting";
    this.message = "Connecting to Quotex market data...";
    this.error = undefined;

    try {
      const session = forceLogin
        ? await loginToQuotex()
        : await getOrCreateQuotexSession();

      this.client?.disconnect();
      this.client = new QuotexClient();

      this.client.on("quote_stream", (payload) => {
        if (!Array.isArray(payload)) return;
        for (const row of payload) {
          if (Array.isArray(row) && row.length >= 3) {
            const symbol = String(row[0]);
            const price = Number(row[2]);
            if (symbol && Number.isFinite(price)) {
              this.quotes.set(symbol.toUpperCase(), price);
            }
          }
        }
      });

      await this.client.connect(session.ssid);
      this.assets = await this.client.fetchAssets();
      this.status = "connected";
      this.message = "Quotex market data connected";
      this.lastSync = new Date().toISOString();
    } catch (error) {
      this.status = "error";
      this.message = "Failed to connect Quotex market data";
      this.error = error instanceof Error ? error.message : "Unknown Quotex error";
      throw error;
    }
  }

  async getMarketSnapshot(
    symbol: string,
    period = 60
  ): Promise<QuotexMarketSnapshot> {
    if (!this.client?.isConnected) {
      await this.initialize();
    }

    const asset = this.getAsset(symbol);
    if (!asset) {
      throw new Error(`Asset not found in Quotex market list: ${symbol}`);
    }

    let candles: QuotexCandle[] = [];
    try {
      candles = await this.client!.fetchCandles(asset.symbol, period);
    } catch {
      candles = [];
    }

    return {
      symbol: asset.symbol,
      marketType: asset.marketType,
      price: this.getQuote(asset.symbol),
      candles,
    };
  }

  isReady() {
    return this.status === "connected" && this.assets.length > 0;
  }

  listAssets(marketType?: "REAL" | "OTC") {
    if (!marketType) return this.assets;
    return this.assets.filter((asset) => asset.marketType === marketType);
  }
}

export const quotexMarket = new QuotexMarketService();
