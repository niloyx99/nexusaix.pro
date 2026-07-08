export type QuotexMarketType = "REAL" | "OTC";

export interface QuotexAsset {
  id: number;
  symbol: string;
  name: string;
  marketType: QuotexMarketType;
  payout?: number;
  isOpen?: boolean;
}

export interface QuotexSession {
  token?: string;
  sessionId?: string;
  cookies?: string;
  userAgent?: string;
  isDemo: boolean;
  ssid: string;
  savedAt: string;
}

export interface QuotexCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface QuotexMarketSnapshot {
  symbol: string;
  marketType: QuotexMarketType;
  price?: number;
  candles?: QuotexCandle[];
}

export type QuotexConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface QuotexStatus {
  status: QuotexConnectionStatus;
  message: string;
  isDemo: boolean;
  emailConfigured: boolean;
  assets: {
    otc: number;
    real: number;
    total: number;
  };
  lastSync?: string;
  error?: string;
}
