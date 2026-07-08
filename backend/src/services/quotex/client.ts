import WebSocket from "ws";
import { QUOTEX_WS_URLS } from "./config.js";
import type { QuotexAsset, QuotexCandle, QuotexMarketType } from "./types.js";

type EventHandler = (payload: unknown) => void;

function isOtcSymbol(symbol: string): boolean {
  return symbol.toLowerCase().includes("_otc") || symbol.toLowerCase().endsWith("otc");
}

function parseAssets(payload: unknown): QuotexAsset[] {
  if (!Array.isArray(payload)) return [];

  return payload
    .filter((item): item is unknown[] => Array.isArray(item) && item.length >= 3)
    .map((item) => {
      const symbol = String(item[1] || "");
      const marketType: QuotexMarketType = isOtcSymbol(symbol) ? "OTC" : "REAL";
      return {
        id: Number(item[0]),
        symbol,
        name: String(item[2] || symbol),
        marketType,
        payout: typeof item[5] === "number" ? item[5] : undefined,
        isOpen: typeof item[14] === "boolean" ? item[14] : undefined,
      };
    })
    .filter((asset) => asset.symbol);
}

function parseCandles(payload: unknown): QuotexCandle[] {
  if (!payload || typeof payload !== "object") return [];
  const history = (payload as { history?: unknown }).history;
  if (!Array.isArray(history)) return [];

  return history
    .filter((row): row is number[] => Array.isArray(row) && row.length >= 5)
    .map((row) => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
    }));
}

export class QuotexClient {
  private ws: WebSocket | null = null;
  private pendingBinaryEvent: string | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private connected = false;

  on(event: string, handler: EventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  private emit(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) || []) {
      handler(payload);
    }
  }

  private send(message: string) {
    this.ws?.send(message);
  }

  private engineOpen = false;

  private handleTextMessage(message: string) {
    if (message.startsWith("0")) {
      this.engineOpen = true;
      this.send("40");
      return;
    }

    if (message === "2") {
      this.send("3");
      return;
    }

    if (message === "40") {
      this.connected = true;
      this.emit("socket_connected", null);
      return;
    }

    if (message.startsWith("451-[")) {
      try {
        const eventName = message.split('"')[1];
        this.pendingBinaryEvent = eventName;
      } catch {
        this.pendingBinaryEvent = null;
      }
      return;
    }

    if (message.startsWith("42")) {
      try {
        const parsed = JSON.parse(message.slice(2)) as [string, unknown];
        const [event, body] = parsed;
        if (event === "s_authorization") {
          this.emit("authenticated", body);
        } else if (event === "instruments/list") {
          this.emit("assets_list", body);
        } else if (event === "quotes/stream") {
          this.emit("quote_stream", body);
        } else if (
          event === "history/list/v2" ||
          event === "loadHistoryPeriod" ||
          event === "chart_notification/get"
        ) {
          this.emit("candles_received", body);
        } else if (event === "authorization/reject") {
          this.emit("auth_error", body);
        }
      } catch {
        // ignore malformed frames
      }
    }
  }

  private handleBinaryMessage(data: Buffer) {
    const text = data.toString("utf8");
    if (!text.startsWith("\u0004")) return;

    try {
      const payload = JSON.parse(text.slice(1)) as unknown;
      const event = this.pendingBinaryEvent;
      this.pendingBinaryEvent = null;

      if (event === "instruments/list" || (!event && parseAssets(payload).length)) {
        this.emit("assets_list", payload);
        return;
      }

      if (event === "quotes/stream") {
        this.emit("quote_stream", payload);
        return;
      }

      if (
        event === "history/list/v2" ||
        event === "loadHistoryPeriod" ||
        (payload &&
          typeof payload === "object" &&
          "history" in (payload as Record<string, unknown>))
      ) {
        this.emit("candles_received", payload);
        return;
      }

      this.emit("json_data", { event, payload });
    } catch {
      // ignore malformed binary payloads
    }
  }

  private waitForEvent<T = unknown>(
    event: string,
    timeoutMs = 15000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeoutMs);

      const unsubscribe = this.on(event, (payload) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(payload as T);
      });
    });
  }

  private async handshake(ssid: string) {
    await this.waitForEvent("socket_connected", 12000);
    this.send(ssid);

    await Promise.race([
      this.waitForEvent("authenticated", 12000),
      this.waitForEvent("assets_list", 12000),
    ]);

    this.send('451-["instruments/list",{"_placeholder":true,"num":0}]');
  }

  async connect(ssid: string): Promise<void> {
    let lastError: Error | null = null;

    for (const url of QUOTEX_WS_URLS) {
      try {
        await this.disconnect();
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(url, {
            headers: {
              Origin: "https://qxbroker.com",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          this.ws = ws;

          ws.on("open", () => {
            // Engine.IO open frame ('0...') will trigger namespace connect.
          });

          ws.on("message", (data, isBinary) => {
            if (Buffer.isBuffer(data)) {
              if (isBinary || data[0] === 4) {
                this.handleBinaryMessage(data);
                return;
              }
              this.handleTextMessage(data.toString("utf8"));
              return;
            }

            if (typeof data === "string") {
              this.handleTextMessage(data);
            }
          });

          ws.on("error", (error) => {
            lastError = error instanceof Error ? error : new Error(String(error));
          });

          ws.on("close", () => {
            this.connected = false;
          });

          this.handshake(ssid)
            .then(resolve)
            .catch(reject);
        });

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError || new Error("Unable to connect to Quotex WebSocket");
  }

  async fetchAssets(timeoutMs = 20000): Promise<QuotexAsset[]> {
    this.send('451-["instruments/list",{"_placeholder":true,"num":0}]');
    const payload = await this.waitForEvent<unknown>("assets_list", timeoutMs);
    return parseAssets(payload);
  }

  async fetchCandles(
    asset: string,
    period = 60,
    offset = 120
  ): Promise<QuotexCandle[]> {
    const request = {
      asset,
      index: 0,
      time: Math.floor(Date.now() / 1000),
      offset,
      period,
    };

    this.send(`42["history/load/v2",${JSON.stringify(request)}]`);
    const payload = await this.waitForEvent<unknown>("candles_received", 20000);
    return parseCandles(payload);
  }

  async disconnect() {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      this.connected = false;
      await new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
        setTimeout(resolve, 500);
      });
    }
  }

  get isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}
