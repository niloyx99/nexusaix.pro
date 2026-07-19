import type { MarketCandle } from "../market/marketDataClient.js";
import type { Direction } from "../analysis/marketIntelligence.js";

/**
 * Futures-style signal engine for Future Signal generation.
 * Layers: Open Interest · Liquidation · Funding Rate · Volume Profile · VWAP
 * + RSI / EMA / MACD confluence.
 *
 * Real exchange metrics fetched for crypto when Binance symbols map;
 * forex/OTC uses fast candle proxies (same layer names for confluence).
 */

export interface FuturesLayer {
  direction: Direction;
  strength: number;
  label: string;
}

export interface FuturesSignalAnalysis {
  direction: Direction;
  confidence: number;
  engineScore: number;
  daisyScore: number; // confluence score (kept for API/UI compatibility)
  alignedCount: number;
  reasons: string[];
  layers: {
    openInterest: FuturesLayer;
    liquidation: FuturesLayer;
    funding: FuturesLayer;
    volumeProfile: FuturesLayer;
    vwap: FuturesLayer;
    momentum: FuturesLayer;
  };
}

interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  range: number;
  body: number;
  upper: number;
  lower: number;
  vol: number;
  activity: number;
  typical: number;
  bullish: boolean;
  bearish: boolean;
}

function parseBars(candles: MarketCandle[]): Bar[] {
  return candles
    .map((c) => {
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);
      if (![open, high, low, close].every(Number.isFinite)) return null;
      const range = Math.max(high - low, 1e-8);
      const body = Math.abs(close - open);
      const vol = Number(c.tick_volume ?? 0);
      const activity =
        Number.isFinite(vol) && vol > 0 ? vol : Math.max(body / range, 0.12) * 1e3;
      return {
        open,
        high,
        low,
        close,
        range,
        body,
        upper: high - Math.max(open, close),
        lower: Math.min(open, close) - low,
        vol: Number.isFinite(vol) && vol > 0 ? vol : 0,
        activity,
        typical: (high + low + close) / 3,
        bullish: close > open,
        bearish: close < open,
      };
    })
    .filter((b): b is Bar => b !== null);
}

function vote(up: number, down: number, min = 0.8): Direction {
  if (up - down >= min) return "UP";
  if (down - up >= min) return "DOWN";
  return "SIDEWAYS";
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let v = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) v = values[i] * k + v * (1 - k);
  return v;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/** Map Quotex-ish symbols → Binance USDT-M futures. Never for OTC. */
export function toBinanceFuturesSymbol(pair: string): string | null {
  if (/_otc$/i.test(pair)) return null;
  const base = pair.replace(/_otc$/i, "").toUpperCase();
  const map: Record<string, string> = {
    BTCUSD: "BTCUSDT",
    ETHUSD: "ETHUSDT",
    BNBUSD: "BNBUSDT",
    SOLUSD: "SOLUSDT",
    XRPUSD: "XRPUSDT",
    DOGEUSD: "DOGEUSDT",
    ADAUSD: "ADAUSDT",
    LTCUSD: "LTCUSDT",
    LINKUSD: "LINKUSDT",
    AVAUSD: "AVAXUSDT",
    ATOUSD: "ATOMUSDT",
    MATUSD: "MATICUSDT",
    DOTUSD: "DOTUSDT",
    TRXUSD: "TRXUSDT",
  };
  return map[base] ?? null;
}

interface BinanceDerivatives {
  oiChangePct: number | null;
  fundingRate: number | null;
  markPremiumPct: number | null;
}

const binanceCache = new Map<string, { at: number; data: BinanceDerivatives }>();
const BINANCE_CACHE_MS = 45_000;

async function fetchBinanceDerivatives(symbol: string): Promise<BinanceDerivatives> {
  const cached = binanceCache.get(symbol);
  if (cached && Date.now() - cached.at < BINANCE_CACHE_MS) return cached.data;

  const empty: BinanceDerivatives = {
    oiChangePct: null,
    fundingRate: null,
    markPremiumPct: null,
  };

  try {
    const [oiHistRes, premiumRes] = await Promise.all([
      fetch(
        `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=6`,
        { signal: AbortSignal.timeout(2500) }
      ),
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, {
        signal: AbortSignal.timeout(2500),
      }),
    ]);

    let oiChangePct: number | null = null;
    if (oiHistRes.ok) {
      const hist = (await oiHistRes.json()) as Array<{ sumOpenInterest: string }>;
      if (Array.isArray(hist) && hist.length >= 2) {
        const first = Number(hist[0].sumOpenInterest);
        const last = Number(hist[hist.length - 1].sumOpenInterest);
        if (first > 0 && Number.isFinite(last)) {
          oiChangePct = ((last - first) / first) * 100;
        }
      }
    }

    let fundingRate: number | null = null;
    let markPremiumPct: number | null = null;
    if (premiumRes.ok) {
      const prem = (await premiumRes.json()) as {
        lastFundingRate?: string;
        markPrice?: string;
        indexPrice?: string;
      };
      const fr = Number(prem.lastFundingRate);
      if (Number.isFinite(fr)) fundingRate = fr * 100; // to %
      const mark = Number(prem.markPrice);
      const index = Number(prem.indexPrice);
      if (mark > 0 && index > 0) {
        markPremiumPct = ((mark - index) / index) * 100;
      }
    }

    const data = { oiChangePct, fundingRate, markPremiumPct };
    binanceCache.set(symbol, { at: Date.now(), data });
    return data;
  } catch {
    return empty;
  }
}

/** Open Interest: rising OI + up price = longs; rising OI + down = shorts. */
function layerOpenInterest(
  bars: Bar[],
  live: BinanceDerivatives | null
): FuturesLayer {
  if (bars.length < 8) {
    return { direction: "SIDEWAYS", strength: 0, label: "OI thin" };
  }

  let up = 0;
  let down = 0;
  let label = "OI neutral";

  if (live?.oiChangePct != null && Number.isFinite(live.oiChangePct)) {
    const oi = live.oiChangePct;
    const priceUp = bars[bars.length - 1].close > bars[bars.length - 4].close;
    if (oi > 0.15 && priceUp) {
      up += 5;
      label = `OI rising +${oi.toFixed(2)}% · longs`;
    } else if (oi > 0.15 && !priceUp) {
      down += 5;
      label = `OI rising +${oi.toFixed(2)}% · shorts`;
    } else if (oi < -0.15 && priceUp) {
      down += 3;
      label = `OI falling · short cover`;
    } else if (oi < -0.15 && !priceUp) {
      up += 3;
      label = `OI falling · long unwind`;
    }
  }

  // Candle proxy: cumulative activity expansion = synthetic OI build
  const early = bars.slice(-12, -6);
  const late = bars.slice(-6);
  if (early.length && late.length) {
    const a1 = early.reduce((s, b) => s + b.activity, 0) / early.length;
    const a2 = late.reduce((s, b) => s + b.activity, 0) / late.length;
    const oiProxy = (a2 - a1) / Math.max(a1, 1);
    const priceUp = late[late.length - 1].close >= early[0].close;
    if (oiProxy > 0.12) {
      if (priceUp) {
        up += 3;
        if (label === "OI neutral") label = "OI proxy build · longs";
      } else {
        down += 3;
        if (label === "OI neutral") label = "OI proxy build · shorts";
      }
    }
  }

  return {
    direction: vote(up, down, 1.5),
    strength: Math.min(10, Math.max(up, down)),
    label,
  };
}

/** Liquidation: wick+volume cascades at extremes (stop-hunt / liq flush). */
function layerLiquidation(bars: Bar[]): FuturesLayer {
  if (bars.length < 6) {
    return { direction: "SIDEWAYS", strength: 0, label: "Liq thin" };
  }
  const last = bars[bars.length - 1];
  const prior = bars.slice(-10, -1);
  const avgAct = prior.reduce((s, b) => s + b.activity, 0) / Math.max(1, prior.length);
  const hi = Math.max(...prior.map((b) => b.high));
  const lo = Math.min(...prior.map((b) => b.low));

  let up = 0;
  let down = 0;
  let label = "No liquidation flush";

  const volSpike = last.activity >= avgAct * 1.35;
  const upperLiq =
    last.high >= hi &&
    last.upper / last.range >= 0.32 &&
    last.close < hi &&
    (volSpike || last.upper / last.range >= 0.45);
  const lowerLiq =
    last.low <= lo &&
    last.lower / last.range >= 0.32 &&
    last.close > lo &&
    (volSpike || last.lower / last.range >= 0.45);

  // Long liq below → bounce (CALL). Short liq above → dump (PUT).
  if (lowerLiq) {
    up += volSpike ? 6 : 4;
    label = "Long liquidation flush · bounce";
  }
  if (upperLiq) {
    down += volSpike ? 6 : 4;
    label = "Short liquidation flush · drop";
  }

  // Cascade: 2 consecutive extreme wicks
  const prev = bars[bars.length - 2];
  if (
    last.lower / last.range >= 0.35 &&
    prev.lower / prev.range >= 0.3 &&
    last.bullish
  ) {
    up += 2;
    label = "Stacked long-liq wicks";
  }
  if (
    last.upper / last.range >= 0.35 &&
    prev.upper / prev.range >= 0.3 &&
    last.bearish
  ) {
    down += 2;
    label = "Stacked short-liq wicks";
  }

  return {
    direction: vote(up, down, 1.5),
    strength: Math.min(10, Math.max(up, down)),
    label,
  };
}

/** Funding Rate: positive funding → fade longs (PUT bias); negative → fade shorts. */
function layerFunding(
  bars: Bar[],
  live: BinanceDerivatives | null
): FuturesLayer {
  let up = 0;
  let down = 0;
  let label = "Funding neutral";

  if (live?.fundingRate != null && Number.isFinite(live.fundingRate)) {
    const fr = live.fundingRate; // already %
    if (fr >= 0.05) {
      down += 4;
      label = `Funding +${fr.toFixed(3)}% · fade longs`;
    } else if (fr <= -0.05) {
      up += 4;
      label = `Funding ${fr.toFixed(3)}% · fade shorts`;
    } else if (fr > 0.01) {
      down += 1;
      label = `Funding mild +${fr.toFixed(3)}%`;
    } else if (fr < -0.01) {
      up += 1;
      label = `Funding mild ${fr.toFixed(3)}%`;
    }
  }

  if (live?.markPremiumPct != null) {
    if (live.markPremiumPct > 0.04) down += 2;
    if (live.markPremiumPct < -0.04) up += 2;
  }

  // Proxy: distance of close vs VWAP-ish mean as synthetic funding pressure
  if (bars.length >= 10 && up + down < 2) {
    const window = bars.slice(-20);
    let pv = 0;
    let vv = 0;
    for (const b of window) {
      pv += b.typical * b.activity;
      vv += b.activity;
    }
    const vwap = pv / Math.max(vv, 1);
    const last = bars[bars.length - 1].close;
    const prem = ((last - vwap) / vwap) * 100;
    if (prem > 0.04) {
      down += 3;
      label = "Premium vs VWAP · fade";
    } else if (prem < -0.04) {
      up += 3;
      label = "Discount vs VWAP · bounce";
    }
  }

  return {
    direction: vote(up, down, 1),
    strength: Math.min(10, Math.max(up, down)),
    label,
  };
}

/** Volume Profile: POC / value area — react or break. */
function layerVolumeProfile(bars: Bar[]): FuturesLayer {
  if (bars.length < 12) {
    return { direction: "SIDEWAYS", strength: 0, label: "VP thin" };
  }

  const window = bars.slice(-40);
  const lo = Math.min(...window.map((b) => b.low));
  const hi = Math.max(...window.map((b) => b.high));
  const span = Math.max(hi - lo, 1e-8);
  const bins = 24;
  const vol = new Array(bins).fill(0);

  for (const b of window) {
    const mid = (b.high + b.low) / 2;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((mid - lo) / span) * bins)));
    vol[idx] += b.activity;
  }

  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (vol[i] > vol[pocIdx]) pocIdx = i;
  const poc = lo + ((pocIdx + 0.5) / bins) * span;

  // Value area ~70% volume around POC
  const total = vol.reduce((a, b) => a + b, 0) || 1;
  let covered = vol[pocIdx];
  let left = pocIdx;
  let right = pocIdx;
  while (covered / total < 0.7 && (left > 0 || right < bins - 1)) {
    const expandL = left > 0 ? vol[left - 1] : -1;
    const expandR = right < bins - 1 ? vol[right + 1] : -1;
    if (expandL >= expandR && left > 0) {
      left -= 1;
      covered += vol[left];
    } else if (right < bins - 1) {
      right += 1;
      covered += vol[right];
    } else if (left > 0) {
      left -= 1;
      covered += vol[left];
    } else break;
  }
  const val = lo + (left / bins) * span;
  const vah = lo + ((right + 1) / bins) * span;

  const last = bars[bars.length - 1];
  let up = 0;
  let down = 0;
  let label = "At value area";

  if (last.close > vah && last.bullish) {
    up += 4;
    label = "Break above VAH";
  } else if (last.close < val && last.bearish) {
    down += 4;
    label = "Break below VAL";
  } else if (last.low <= poc && last.close > poc) {
    up += 5;
    label = "POC support hold";
  } else if (last.high >= poc && last.close < poc) {
    down += 5;
    label = "POC resistance reject";
  } else if (last.close > poc) {
    up += 2;
    label = "Above POC";
  } else if (last.close < poc) {
    down += 2;
    label = "Below POC";
  }

  return {
    direction: vote(up, down, 1),
    strength: Math.min(10, Math.max(up, down)),
    label,
  };
}

/** Session VWAP bias. */
function layerVwap(bars: Bar[]): FuturesLayer {
  if (bars.length < 8) {
    return { direction: "SIDEWAYS", strength: 0, label: "VWAP thin" };
  }
  const window = bars.slice(-50);
  let pv = 0;
  let vv = 0;
  for (const b of window) {
    pv += b.typical * b.activity;
    vv += b.activity;
  }
  const vwap = pv / Math.max(vv, 1);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const dist = ((last.close - vwap) / vwap) * 100;

  let up = 0;
  let down = 0;
  let label = "At VWAP";

  if (last.close > vwap && prev.close <= vwap) {
    up += 5;
    label = "VWAP reclaim";
  } else if (last.close < vwap && prev.close >= vwap) {
    down += 5;
    label = "VWAP lose";
  } else if (last.close > vwap) {
    up += dist > 0.03 ? 4 : 2;
    label = "Price above VWAP";
  } else if (last.close < vwap) {
    down += dist < -0.03 ? 4 : 2;
    label = "Price below VWAP";
  }

  // Rejection from VWAP
  if (last.low < vwap && last.close > vwap && last.lower / last.range >= 0.25) {
    up += 3;
    label = "VWAP bounce";
  }
  if (last.high > vwap && last.close < vwap && last.upper / last.range >= 0.25) {
    down += 3;
    label = "VWAP reject";
  }

  return {
    direction: vote(up, down, 1),
    strength: Math.min(10, Math.max(up, down)),
    label,
  };
}

/** Extra confluence: RSI + EMA + short MACD hist. */
function layerMomentum(bars: Bar[]): FuturesLayer {
  const closes = bars.map((b) => b.close);
  if (closes.length < 20) {
    return { direction: "SIDEWAYS", strength: 0, label: "Momentum thin" };
  }

  let up = 0;
  let down = 0;
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const r = rsi(closes, 14);
  const last = closes[closes.length - 1];

  if (e9 != null && e21 != null) {
    if (e9 > e21 && last > e9) up += 3;
    if (e9 < e21 && last < e9) down += 3;
  }
  if (r != null) {
    if (r >= 55 && r <= 72) up += 2;
    if (r <= 45 && r >= 28) down += 2;
    if (r > 78) down += 1; // overbought caution
    if (r < 22) up += 1;
  }

  // Mini MACD hist direction
  if (closes.length >= 35) {
    const e12 = ema(closes, 12);
    const e26 = ema(closes, 26);
    if (e12 != null && e26 != null) {
      const macd = e12 - e26;
      const prevCloses = closes.slice(0, -1);
      const p12 = ema(prevCloses, 12);
      const p26 = ema(prevCloses, 26);
      if (p12 != null && p26 != null) {
        const prevMacd = p12 - p26;
        if (macd > 0 && macd > prevMacd) up += 2;
        if (macd < 0 && macd < prevMacd) down += 2;
      }
    }
  }

  const dir = vote(up, down, 1);
  return {
    direction: dir,
    strength: Math.min(10, Math.max(up, down)),
    label:
      dir === "UP"
        ? "RSI/EMA/MACD bullish"
        : dir === "DOWN"
          ? "RSI/EMA/MACD bearish"
          : "Momentum mixed",
  };
}

export async function analyzeFuturesSignal(
  candles: MarketCandle[],
  pair?: string,
  options?: { marketType?: "REAL" | "OTC" }
): Promise<FuturesSignalAnalysis> {
  const marketType = options?.marketType ?? "REAL";
  const bars = parseBars(candles);
  const empty = (label: string): FuturesLayer => ({
    direction: "SIDEWAYS",
    strength: 0,
    label,
  });

  if (bars.length < 8) {
    return {
      direction: "SIDEWAYS",
      confidence: 48,
      engineScore: 48,
      daisyScore: 40,
      alignedCount: 0,
      reasons: ["Need more candles"],
      layers: {
        openInterest: empty("OI waiting"),
        liquidation: empty("Liq waiting"),
        funding: empty("Funding waiting"),
        volumeProfile: empty("VP waiting"),
        vwap: empty("VWAP waiting"),
        momentum: empty("Momentum waiting"),
      },
    };
  }

  // Binance futures only for REAL crypto — never on OTC Quotex signals
  let live: BinanceDerivatives | null = null;
  if (marketType === "REAL") {
    const binanceSym = pair ? toBinanceFuturesSymbol(pair) : null;
    if (binanceSym) {
      live = await fetchBinanceDerivatives(binanceSym);
    }
  }

  const layers = {
    openInterest: layerOpenInterest(bars, live),
    liquidation: layerLiquidation(bars),
    funding: layerFunding(bars, live),
    volumeProfile: layerVolumeProfile(bars),
    vwap: layerVwap(bars),
    momentum: layerMomentum(bars),
  };

  // OTC: heavier weight on candle microstructure (VP/VWAP/momentum), lighter on OI/funding proxies
  const weights: Record<keyof typeof layers, number> =
    marketType === "OTC"
      ? {
          openInterest: 0.85,
          liquidation: 1.2,
          funding: 0.7,
          volumeProfile: 1.65,
          vwap: 1.7,
          momentum: 1.45,
        }
      : {
          openInterest: 1.45,
          liquidation: 1.55,
          funding: 1.35,
          volumeProfile: 1.4,
          vwap: 1.5,
          momentum: 1.15,
        };

  let upScore = 0;
  let downScore = 0;
  const reasons: string[] = [];

  (Object.keys(layers) as (keyof typeof layers)[]).forEach((key) => {
    const L = layers[key];
    const w = weights[key];
    if (L.direction === "UP") upScore += L.strength * w;
    if (L.direction === "DOWN") downScore += L.strength * w;
    if (L.strength >= 3 && L.direction !== "SIDEWAYS") reasons.push(L.label);
  });

  const alignedUp = Object.values(layers).filter(
    (l) => l.direction === "UP" && l.strength >= 2
  ).length;
  const alignedDown = Object.values(layers).filter(
    (l) => l.direction === "DOWN" && l.strength >= 2
  ).length;

  let direction: Direction = "SIDEWAYS";
  if (upScore - downScore >= 3.5) direction = "UP";
  else if (downScore - upScore >= 3.5) direction = "DOWN";
  else if (alignedUp >= 4 && alignedUp > alignedDown) direction = "UP";
  else if (alignedDown >= 4 && alignedDown > alignedUp) direction = "DOWN";

  const alignedCount =
    direction === "UP" ? alignedUp : direction === "DOWN" ? alignedDown : 0;

  const dominant = Math.max(upScore, downScore);
  const total = upScore + downScore || 1;
  let confidence = Math.round(54 + (dominant / total) * 32);
  let engineScore = Math.round(50 + (dominant / total) * 40);

  if (alignedCount >= 5) {
    confidence = Math.min(92, confidence + 6);
    engineScore = Math.min(94, engineScore + 6);
  } else if (alignedCount >= 4) {
    confidence = Math.min(88, confidence + 3);
    engineScore = Math.min(90, engineScore + 3);
  }

  if (direction !== "SIDEWAYS" && alignedCount < 3) {
    direction = "SIDEWAYS";
    confidence = Math.min(confidence, 56);
    reasons.unshift("Weak futures confluence");
  } else if (direction !== "SIDEWAYS") {
    reasons.unshift(`Futures confluence ×${alignedCount}/6`);
  }

  const daisyScore = Math.round(
    Math.min(
      96,
      alignedCount * 12 +
        layers.vwap.strength * 2 +
        layers.liquidation.strength * 2 +
        layers.openInterest.strength * 1.5
    )
  );

  return {
    direction,
    confidence: Math.max(48, Math.min(92, confidence)),
    engineScore: Math.max(48, Math.min(95, engineScore)),
    daisyScore: Math.max(40, Math.min(96, daisyScore)),
    alignedCount,
    reasons: reasons.slice(0, 6),
    layers,
  };
}
