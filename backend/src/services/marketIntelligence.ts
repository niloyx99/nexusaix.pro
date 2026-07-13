import type { MarketCandle } from "./marketDataClient.js";
import { analyzeWickAndVolume } from "./tradeSetupRules.js";

export type Direction = "UP" | "DOWN" | "SIDEWAYS";
export type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface MarketIntelligence {
  momentum: Bias;
  nextCandleDirection: Direction;
  confidencePct: number;
  liquiditySweep: {
    detected: boolean;
    type: "BSL_SWEEP" | "SSL_SWEEP" | "NONE";
    description: string;
  };
  mmxm: {
    phase: "ACCUMULATION" | "MANIPULATION" | "EXPANSION" | "DISTRIBUTION" | "UNKNOWN";
    model: "MMBM" | "MMSM" | "NONE";
    description: string;
  };
  msnr: {
    support: number | null;
    resistance: number | null;
    signal: "SBR" | "RBS" | "FRESH_REJECTION" | "NONE";
    description: string;
  };
  priceAction: {
    pattern: string;
    rejection: boolean;
    description: string;
  };
  oppositeCandleSignal: {
    detected: boolean;
    nextBias: Direction;
    description: string;
  };
  otcInsight: string;
  summaryMarkdown: string;
  fusionBullets: string[];
}

interface ParsedCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  bodyTop: number;
  bodyBottom: number;
  bodySize: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  bullish: boolean;
  bearish: boolean;
  dateTime: string;
}

function parseCandles(candles: MarketCandle[]): ParsedCandle[] {
  return candles
    .map((c) => {
      const open = Number(c.open);
      const high = Number(c.high);
      const low = Number(c.low);
      const close = Number(c.close);
      if (![open, high, low, close].every(Number.isFinite)) return null;

      const bodyTop = Math.max(open, close);
      const bodyBottom = Math.min(open, close);
      const bodySize = Math.abs(close - open);
      const range = high - low || 0.00001;

      return {
        open,
        high,
        low,
        close,
        bodyTop,
        bodyBottom,
        bodySize,
        range,
        upperWick: high - bodyTop,
        lowerWick: bodyBottom - low,
        bullish: close > open,
        bearish: close < open,
        dateTime: c.date_time || "",
      };
    })
    .filter((c): c is ParsedCandle => c !== null);
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function findSwingHighs(candles: ParsedCandle[], lookback = 2): number[] {
  const levels: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const h = candles[i].high;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].high >= h) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) levels.push(h);
  }
  return levels;
}

function findSwingLows(candles: ParsedCandle[], lookback = 2): number[] {
  const levels: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const l = candles[i].low;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (candles[j].low <= l) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) levels.push(l);
  }
  return levels;
}

function nearestLevel(price: number, levels: number[], side: "below" | "above"): number | null {
  const filtered =
    side === "below"
      ? levels.filter((l) => l <= price)
      : levels.filter((l) => l >= price);
  if (!filtered.length) return null;
  return filtered.reduce((best, lvl) =>
    Math.abs(lvl - price) < Math.abs(best - price) ? lvl : best
  );
}

function detectLiquiditySweep(candles: ParsedCandle[]): MarketIntelligence["liquiditySweep"] {
  if (candles.length < 6) {
    return { detected: false, type: "NONE", description: "Insufficient candles for liquidity scan." };
  }

  const prior = candles.slice(0, -1);
  const last = candles[candles.length - 1];
  const swingHighs = findSwingHighs(prior);
  const swingLows = findSwingLows(prior);

  const recentHigh = swingHighs.length ? Math.max(...swingHighs.slice(-3)) : Math.max(...prior.slice(-5).map((c) => c.high));
  const recentLow = swingLows.length ? Math.min(...swingLows.slice(-3)) : Math.min(...prior.slice(-5).map((c) => c.low));

  // BSL sweep: wick above swing high, close back below (smart money sell setup)
  if (last.high > recentHigh && last.close < recentHigh) {
    return {
      detected: true,
      type: "BSL_SWEEP",
      description: `Buy-side liquidity swept above **${recentHigh.toFixed(5)}** — price wicked high then closed back inside (bearish SMC grab).`,
    };
  }

  // SSL sweep: wick below swing low, close back above (smart money buy setup)
  if (last.low < recentLow && last.close > recentLow) {
    return {
      detected: true,
      type: "SSL_SWEEP",
      description: `Sell-side liquidity swept below **${recentLow.toFixed(5)}** — price wicked low then closed back inside (bullish SMC grab).`,
    };
  }

  return {
    detected: false,
    type: "NONE",
    description: "No fresh liquidity sweep on the latest candle.",
  };
}

function detectFairValueGap(candles: ParsedCandle[]): "BULLISH_FVG" | "BEARISH_FVG" | "NONE" {
  if (candles.length < 3) return "NONE";
  const c1 = candles[candles.length - 3];
  const c3 = candles[candles.length - 1];
  if (c3.low > c1.high) return "BULLISH_FVG";
  if (c3.high < c1.low) return "BEARISH_FVG";
  return "NONE";
}

function detectPriceAction(candles: ParsedCandle[]): MarketIntelligence["priceAction"] {
  if (candles.length < 2) {
    return { pattern: "NONE", rejection: false, description: "Not enough candles." };
  }

  const prev = candles[candles.length - 2];
  const last = candles[candles.length - 1];

  const bullishEngulf =
    last.bullish &&
    prev.bearish &&
    last.bodyBottom <= prev.bodyBottom &&
    last.bodyTop >= prev.bodyTop;

  const bearishEngulf =
    last.bearish &&
    prev.bullish &&
    last.bodyTop >= prev.bodyTop &&
    last.bodyBottom <= prev.bodyBottom;

  if (bullishEngulf) {
    return {
      pattern: "BULLISH_ENGULFING",
      rejection: false,
      description: "Bullish engulfing — buyers absorbed prior candle (price action confirmation).",
    };
  }

  if (bearishEngulf) {
    return {
      pattern: "BEARISH_ENGULFING",
      rejection: false,
      description: "Bearish engulfing — sellers absorbed prior candle (price action confirmation).",
    };
  }

  const upperWickRatio = last.upperWick / last.range;
  const lowerWickRatio = last.lowerWick / last.range;

  if (upperWickRatio > 0.55 && last.bodySize / last.range < 0.35) {
    return {
      pattern: "SHOOTING_STAR",
      rejection: true,
      description: "Upper rejection wick — supply rejected higher prices (MSNR fresh resistance reaction).",
    };
  }

  if (lowerWickRatio > 0.55 && last.bodySize / last.range < 0.35) {
    return {
      pattern: "HAMMER",
      rejection: true,
      description: "Lower rejection wick — demand absorbed sell pressure (MSNR fresh support reaction).",
    };
  }

  if (last.bullish && last.close > prev.high) {
    return {
      pattern: "BULLISH_BREAKOUT",
      rejection: false,
      description: "Bullish close above prior high — momentum continuation bias.",
    };
  }

  if (last.bearish && last.close < prev.low) {
    return {
      pattern: "BEARISH_BREAKOUT",
      rejection: false,
      description: "Bearish close below prior low — momentum continuation bias.",
    };
  }

  return {
    pattern: "INSIDE_BAR",
    rejection: false,
    description: "Consolidation / inside structure — wait for expansion candle.",
  };
}

function detectMsnr(
  candles: ParsedCandle[],
  lastClose: number
): MarketIntelligence["msnr"] {
  const bodyHighs = candles.map((c) => c.bodyTop);
  const bodyLows = candles.map((c) => c.bodyBottom);
  const swingHighs = findSwingHighs(candles);
  const swingLows = findSwingLows(candles);

  const resistance = nearestLevel(lastClose, [...swingHighs, ...bodyHighs], "above");
  const support = nearestLevel(lastClose, [...swingLows, ...bodyLows], "below");

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  if (resistance && last.high >= resistance * 0.9999 && last.close < resistance) {
    return {
      support,
      resistance,
      signal: "RBS",
      description: `MSNR RBS — resistance at **${resistance.toFixed(5)}** held; broken resistance acting as supply (Malaysian SNR flip).`,
    };
  }

  if (support && last.low <= support * 1.0001 && last.close > support) {
    return {
      support,
      resistance,
      signal: "SBR",
      description: `MSNR SBR — support at **${support.toFixed(5)}** held; broken support acting as demand (Malaysian SNR flip).`,
    };
  }

  if (
    (last.upperWick / last.range > 0.5 && resistance) ||
    (last.lowerWick / last.range > 0.5 && support)
  ) {
    return {
      support,
      resistance,
      signal: "FRESH_REJECTION",
      description: "Fresh MSNR level rejection — untested zone reacted with wick confirmation.",
    };
  }

  return {
    support,
    resistance,
    signal: "NONE",
    description: "Price between MSNR zones — no fresh SBR/RBS trigger yet.",
  };
}

function detectMmxm(
  candles: ParsedCandle[],
  liquiditySweep: MarketIntelligence["liquiditySweep"],
  momentum: Bias
): MarketIntelligence["mmxm"] {
  if (!liquiditySweep.detected) {
    const last3 = candles.slice(-3);
    const expanding =
      last3.length === 3 &&
      last3[2].bodySize > last3[1].bodySize &&
      last3[1].bodySize > last3[0].bodySize;

    if (expanding && momentum === "BULLISH") {
      return {
        phase: "EXPANSION",
        model: "MMBM",
        description: "MMXM expansion leg — bullish displacement after accumulation (smart money delivery up).",
      };
    }
    if (expanding && momentum === "BEARISH") {
      return {
        phase: "EXPANSION",
        model: "MMSM",
        description: "MMXM expansion leg — bearish displacement after distribution (smart money delivery down).",
      };
    }

    return {
      phase: "UNKNOWN",
      model: "NONE",
      description: "MMXM not in active manipulation — monitoring consolidation.",
    };
  }

  if (liquiditySweep.type === "SSL_SWEEP") {
    return {
      phase: "MANIPULATION",
      model: "MMBM",
      description: "Market Maker Buy Model — SSL swept, manipulation complete; expect bullish expansion next.",
    };
  }

  if (liquiditySweep.type === "BSL_SWEEP") {
    return {
      phase: "MANIPULATION",
      model: "MMSM",
      description: "Market Maker Sell Model — BSL swept, manipulation complete; expect bearish expansion next.",
    };
  }

  return { phase: "UNKNOWN", model: "NONE", description: "MMXM phase unclear." };
}

/**
 * Core OTC logic: if the last candle moved opposite to the short-term trend
 * (liquidity grab / stop hunt), the NEXT candle often expands in the reversal direction.
 */
function detectOppositeCandleReversal(
  candles: ParsedCandle[],
  liquiditySweep: MarketIntelligence["liquiditySweep"],
  momentum: Bias
): MarketIntelligence["oppositeCandleSignal"] {
  if (candles.length < 5) {
    return {
      detected: false,
      nextBias: "SIDEWAYS",
      description: "Need more candles for opposite-side reversal logic.",
    };
  }

  const closes = candles.map((c) => c.close);
  const shortTrend =
    closes[closes.length - 1] > closes[closes.length - 4] ? "UP" : "DOWN";
  const last = candles[candles.length - 1];

  // Opposite-side move: bearish candle in short uptrend or bullish in short downtrend
  const oppositeMove =
    (shortTrend === "UP" && last.bearish) || (shortTrend === "DOWN" && last.bullish);

  if (liquiditySweep.detected) {
    const nextBias: Direction =
      liquiditySweep.type === "SSL_SWEEP"
        ? "UP"
        : liquiditySweep.type === "BSL_SWEEP"
          ? "DOWN"
          : "SIDEWAYS";

    return {
      detected: true,
      nextBias,
      description:
        "Opposite-side liquidity grab detected — SMC/MMXM rules favor **next candle** moving toward the reversal expansion direction.",
    };
  }

  if (oppositeMove && last.range > avg(candles.slice(-6, -1).map((c) => c.range)) * 1.1) {
    const nextBias: Direction = last.bullish ? "UP" : "DOWN";
    return {
      detected: true,
      nextBias,
      description:
        "Opposite-side displacement candle — next 1-min candle expected to continue in the **reversal/expansion** direction (OTC high-accuracy model).",
    };
  }

  if (momentum === "BULLISH" && last.bearish && last.lowerWick > last.bodySize * 1.2) {
    return {
      detected: true,
      nextBias: "UP",
      description:
        "Bullish trend + opposite bearish wick into support — Malaysian SNR + SMC expect buyers on next candle.",
    };
  }

  if (momentum === "BEARISH" && last.bullish && last.upperWick > last.bodySize * 1.2) {
    return {
      detected: true,
      nextBias: "DOWN",
      description:
        "Bearish trend + opposite bullish wick into resistance — Malaysian SNR + SMC expect sellers on next candle.",
    };
  }

  return {
    detected: false,
    nextBias: "SIDEWAYS",
    description: "No high-probability opposite-candle reversal setup.",
  };
}

function detectConsecutiveExpansion(
  candles: ParsedCandle[]
): { bias: Direction; active: boolean; description: string } {
  if (candles.length < 3) {
    return { bias: "SIDEWAYS", active: false, description: "Insufficient candles for expansion scan." };
  }

  const last3 = candles.slice(-3);
  const greenCount = last3.filter((c) => c.bullish).length;
  const redCount = last3.filter((c) => c.bearish).length;
  const rising =
    last3[2].close > last3[1].close && last3[1].close > last3[0].close;
  const falling =
    last3[2].close < last3[1].close && last3[1].close < last3[0].close;
  const avgBody = avg(last3.map((c) => c.bodySize));

  if (greenCount >= 2 && rising && last3[2].bodySize >= avgBody * 0.65) {
    return {
      bias: "UP",
      active: true,
      description:
        "OTC bullish expansion — consecutive green/higher closes; avoid selling into live push.",
    };
  }

  if (redCount >= 2 && falling && last3[2].bodySize >= avgBody * 0.65) {
    return {
      bias: "DOWN",
      active: true,
      description:
        "OTC bearish expansion — consecutive red/lower closes; avoid buying into live dump.",
    };
  }

  return { bias: "SIDEWAYS", active: false, description: "No active OTC expansion streak." };
}

function scoreDirection(signals: {
  momentum: Bias;
  liquiditySweep: MarketIntelligence["liquiditySweep"];
  priceAction: MarketIntelligence["priceAction"];
  opposite: MarketIntelligence["oppositeCandleSignal"];
  mmxm: MarketIntelligence["mmxm"];
  fvg: ReturnType<typeof detectFairValueGap>;
  isOtc: boolean;
  expansion: ReturnType<typeof detectConsecutiveExpansion>;
  wickDir?: Direction;
  wickStrength?: number;
  volumeDir?: Direction;
  volumeStrength?: number;
}): { direction: Direction; confidence: number } {
  let up = 0;
  let down = 0;

  if (signals.momentum === "BULLISH") up += 2;
  if (signals.momentum === "BEARISH") down += 2;

  if (signals.liquiditySweep.type === "SSL_SWEEP") up += 5;
  if (signals.liquiditySweep.type === "BSL_SWEEP") down += 5;

  if (signals.opposite.detected) {
    if (signals.opposite.nextBias === "UP") up += 4;
    if (signals.opposite.nextBias === "DOWN") down += 4;
  }

  if (signals.mmxm.model === "MMBM" && signals.mmxm.phase === "MANIPULATION") up += 3;
  if (signals.mmxm.model === "MMSM" && signals.mmxm.phase === "MANIPULATION") down += 3;
  if (signals.mmxm.phase === "EXPANSION" && signals.mmxm.model === "MMBM") up += 2;
  if (signals.mmxm.phase === "EXPANSION" && signals.mmxm.model === "MMSM") down += 2;

  if (signals.priceAction.pattern === "BULLISH_ENGULFING") up += 3;
  if (signals.priceAction.pattern === "BEARISH_ENGULFING") down += 3;
  if (signals.priceAction.pattern === "HAMMER") up += 2;
  if (signals.priceAction.pattern === "SHOOTING_STAR") down += 2;
  if (signals.priceAction.pattern === "BULLISH_BREAKOUT") up += 2;
  if (signals.priceAction.pattern === "BEARISH_BREAKOUT") down += 2;

  if (signals.fvg === "BULLISH_FVG") up += 1;
  if (signals.fvg === "BEARISH_FVG") down += 1;

  // Wick shadow + volume scoring (REAL & OTC)
  const ws = signals.wickStrength ?? 0;
  const vs = signals.volumeStrength ?? 0;
  if (signals.wickDir === "UP") up += ws;
  if (signals.wickDir === "DOWN") down += ws;
  if (signals.volumeDir === "UP") up += vs;
  if (signals.volumeDir === "DOWN") down += vs;

  if (signals.isOtc) {
    if (signals.expansion.active) {
      if (signals.expansion.bias === "UP") {
        up += 8;
        down = Math.max(0, down - 6);
      }
      if (signals.expansion.bias === "DOWN") {
        down += 8;
        up = Math.max(0, up - 6);
      }
    } else {
      if (signals.momentum === "BULLISH") up += 3;
      if (signals.momentum === "BEARISH") down += 3;
    }
    if (signals.liquiditySweep.detected && signals.opposite.detected) {
      if (signals.liquiditySweep.type === "SSL_SWEEP" && signals.opposite.nextBias === "UP") up += 4;
      if (signals.liquiditySweep.type === "BSL_SWEEP" && signals.opposite.nextBias === "DOWN") down += 4;
    }
    if (signals.priceAction.rejection) {
      if (signals.priceAction.pattern === "HAMMER") up += 3;
      if (signals.priceAction.pattern === "SHOOTING_STAR") down += 3;
    }
  } else {
    if (signals.momentum === "BULLISH") {
      up += 3;
      down = Math.max(0, down - 2);
    }
    if (signals.momentum === "BEARISH") {
      down += 3;
      up = Math.max(0, up - 2);
    }
  }

  const total = up + down || 1;
  const diff = up - down;

  // Lower threshold → fewer SIDEWAYS/HOLD from engine
  let direction: Direction = "SIDEWAYS";
  if (diff >= 2) direction = "UP";
  else if (diff <= -2) direction = "DOWN";
  else if (up > down && (ws >= 2 || vs >= 2)) direction = "UP";
  else if (down > up && (ws >= 2 || vs >= 2)) direction = "DOWN";

  const dominant = Math.max(up, down);
  let confidence = Math.min(86, Math.max(56, Math.round(50 + (dominant / total) * 36)));

  if (
    signals.opposite.detected &&
    signals.liquiditySweep.detected &&
    signals.opposite.nextBias === direction
  ) {
    confidence = Math.min(88, confidence + 5);
  } else if (signals.opposite.detected && signals.opposite.nextBias === direction) {
    confidence = Math.min(86, confidence + 3);
  } else if (signals.liquiditySweep.detected) {
    const sweepDir =
      signals.liquiditySweep.type === "SSL_SWEEP"
        ? "UP"
        : signals.liquiditySweep.type === "BSL_SWEEP"
          ? "DOWN"
          : "SIDEWAYS";
    if (sweepDir === direction) confidence = Math.min(85, confidence + 2);
  }

  if (ws >= 3 && signals.wickDir === direction) confidence = Math.min(88, confidence + 3);
  if (vs >= 2 && signals.volumeDir === direction) confidence = Math.min(88, confidence + 2);

  if (direction === "SIDEWAYS") confidence = Math.min(confidence, 58);

  return { direction, confidence };
}

function computeMomentum(candles: ParsedCandle[]): Bias {
  const closes = candles.map((c) => c.close);
  const avg5 = avg(closes.slice(-5));
  const avg10 = avg(closes.slice(-10));
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];

  let green = 0;
  let red = 0;
  for (let i = Math.max(1, closes.length - 6); i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) green++;
    else if (closes[i] < closes[i - 1]) red++;
  }

  if (avg5 > avg10 && green >= red && last >= prev) return "BULLISH";
  if (avg5 < avg10 && red >= green && last <= prev) return "BEARISH";
  return "NEUTRAL";
}

export function snapshotDirectionFromOHLC(
  open: number,
  high: number,
  low: number,
  close: number
): Direction {
  const range = Math.max(high - low, 0.00001);
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  if (upperWick / range > 0.38 && body / range < 0.5) return "DOWN";
  if (lowerWick / range > 0.38 && body / range < 0.5) return "UP";
  if (close > open && body / range > 0.45) return "UP";
  if (close < open && body / range > 0.45) return "DOWN";
  return "SIDEWAYS";
}

/** Live API snapshot (single OHLC) — used when candle history is thin. */
export function analyzeLiveSnapshotOHLC(
  snapshot: { open: number; high: number; low: number; close: number },
  options: { isOtc: boolean; payoutPercent: number | null }
): MarketIntelligence {
  const { open, high, low, close } = snapshot;
  const range = Math.max(high - low, 0.00001);
  const body = Math.abs(close - open);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const bullish = close > open;

  const nextDir = snapshotDirectionFromOHLC(open, high, low, close);
  let confidence = nextDir === "SIDEWAYS" ? 52 : 66;

  const upperReject = upperWick / range > 0.38 && body / range < 0.5;
  const lowerReject = lowerWick / range > 0.38 && body / range < 0.5;

  if (upperReject || lowerReject) confidence += 8;
  if (options.payoutPercent && options.payoutPercent >= 80) confidence += 4;
  if (options.isOtc && (upperReject || lowerReject)) confidence += 4;

  confidence = Math.min(88, Math.max(50, confidence));

  const momentum: Bias =
    nextDir === "UP" ? "BULLISH" : nextDir === "DOWN" ? "BEARISH" : "NEUTRAL";

  const liquiditySweep =
    upperReject && close < high - range * 0.15
      ? {
          detected: true,
          type: "BSL_SWEEP" as const,
          description: "Live snapshot: upper wick swept highs then closed lower (bearish grab).",
        }
      : lowerReject && close > low + range * 0.15
        ? {
            detected: true,
            type: "SSL_SWEEP" as const,
            description: "Live snapshot: lower wick swept lows then closed higher (bullish grab).",
          }
        : {
            detected: false,
            type: "NONE" as const,
            description: "No clear liquidity sweep on live snapshot.",
          };

  const oppositeCandleSignal = {
    detected: upperReject || lowerReject,
    nextBias: nextDir,
    description: upperReject
      ? "Rejection wick at top — next candle bias DOWN (OTC reversal model)."
      : lowerReject
        ? "Rejection wick at bottom — next candle bias UP (OTC reversal model)."
        : bullish
          ? "Bullish body — momentum continuation UP."
          : "Bearish body — momentum continuation DOWN.",
  };

  const summaryMarkdown = [
    "### Live Snapshot Feed (Quotex API)",
    `* **OHLC**: O ${open} H ${high} L ${low} C ${close}`,
    `* **Next candle**: **${nextDir}** (${confidence}% confidence)`,
    `* **Wick**: upper ${((upperWick / range) * 100).toFixed(0)}% / lower ${((lowerWick / range) * 100).toFixed(0)}%`,
  ].join("\n");

  return {
    momentum,
    nextCandleDirection: nextDir,
    confidencePct: confidence,
    liquiditySweep,
    mmxm: {
      phase: liquiditySweep.detected ? "MANIPULATION" : "UNKNOWN",
      model: liquiditySweep.type === "SSL_SWEEP" ? "MMBM" : liquiditySweep.type === "BSL_SWEEP" ? "MMSM" : "NONE",
      description: liquiditySweep.detected
        ? "Snapshot shows manipulation wick — expect next-candle expansion."
        : "Awaiting clearer MMXM structure.",
    },
    msnr: {
      support: low,
      resistance: high,
      signal: lowerReject ? "SBR" : upperReject ? "RBS" : "NONE",
      description: lowerReject
        ? "Price rejected lower zone — demand reaction."
        : upperReject
          ? "Price rejected upper zone — supply reaction."
          : "Between snapshot extremes.",
    },
    priceAction: {
      pattern: upperReject ? "SHOOTING_STAR" : lowerReject ? "HAMMER" : bullish ? "BULLISH_BODY" : "BEARISH_BODY",
      rejection: upperReject || lowerReject,
      description: oppositeCandleSignal.description,
    },
    oppositeCandleSignal,
    otcInsight: options.isOtc
      ? "OTC live tick — prioritize wick rejection for next 1-min candle."
      : "REAL live tick — follow body momentum with wick confirmation.",
    summaryMarkdown,
    fusionBullets: summaryMarkdown.split("\n").map((l) => l.replace(/^\* /, "")),
  };
}

export function analyzeMarketIntelligence(
  candles: MarketCandle[],
  options: { isOtc: boolean; payoutPercent: number | null }
): MarketIntelligence {
  const parsed = parseCandles(candles);

  if (parsed.length < 5) {
    return {
      momentum: "NEUTRAL",
      nextCandleDirection: "SIDEWAYS",
      confidencePct: 50,
      liquiditySweep: { detected: false, type: "NONE", description: "Insufficient data." },
      mmxm: { phase: "UNKNOWN", model: "NONE", description: "Insufficient data." },
      msnr: { support: null, resistance: null, signal: "NONE", description: "Insufficient data." },
      priceAction: { pattern: "NONE", rejection: false, description: "Insufficient data." },
      oppositeCandleSignal: {
        detected: false,
        nextBias: "SIDEWAYS",
        description: "Insufficient data.",
      },
      otcInsight: "Waiting for more live candles.",
      summaryMarkdown: "Not enough live candles for SMC/MSNR/MMXM scan.",
      fusionBullets: [],
    };
  }

  const momentum = computeMomentum(parsed);
  const liquiditySweep = detectLiquiditySweep(parsed);
  const priceAction = detectPriceAction(parsed);
  const msnr = detectMsnr(parsed, parsed[parsed.length - 1].close);
  const mmxm = detectMmxm(parsed, liquiditySweep, momentum);
  const oppositeCandleSignal = detectOppositeCandleReversal(parsed, liquiditySweep, momentum);
  const fvg = detectFairValueGap(parsed);
  const expansion = detectConsecutiveExpansion(parsed);
  const wickVol = analyzeWickAndVolume(candles);

  const { direction, confidence } = scoreDirection({
    momentum,
    liquiditySweep,
    priceAction,
    opposite: oppositeCandleSignal,
    mmxm,
    fvg,
    isOtc: options.isOtc,
    expansion,
    wickDir: wickVol.wickDir,
    wickStrength: wickVol.wickStrength,
    volumeDir: wickVol.volumeDir,
    volumeStrength: wickVol.volumeStrength,
  });

  const otcInsight = options.isOtc
    ? expansion.active
      ? `${expansion.description} ${options.payoutPercent && options.payoutPercent >= 85 ? "High payout OTC pair." : ""}`
      : options.payoutPercent && options.payoutPercent >= 85
        ? "OTC market active — high payout pair; prioritize liquidity sweep + opposite-wick reversals (Quotex synthetic behavior)."
        : "OTC market — watch for fake breakouts and quick mean-reversion after manipulation wicks."
    : "REAL market — structure + session liquidity drives bias.";

  const fusionBullets = [
    `**Momentum**: ${momentum}`,
    `**Next candle bias**: ${direction} (${confidence}% engine confidence)`,
    `**Liquidity (SMC)**: ${liquiditySweep.description}`,
    `**MMXM**: ${mmxm.description}`,
    `**MSNR**: ${msnr.description}`,
    `**Price action**: ${priceAction.description}`,
    `**Opposite-candle model**: ${oppositeCandleSignal.description}`,
    expansion.active ? `**OTC expansion**: ${expansion.description}` : "",
    `**FVG**: ${fvg === "NONE" ? "No active fair value gap" : fvg.replace("_", " ")}`,
    `**OTC**: ${otcInsight}`,
  ];

  const summaryMarkdown = [
    "### Live Fusion Engine (SMC + MMXM + MSNR)",
    fusionBullets.map((b) => `* ${b}`).join("\n"),
  ].join("\n\n");

  return {
    momentum,
    nextCandleDirection: direction,
    confidencePct: confidence,
    liquiditySweep,
    mmxm,
    msnr,
    priceAction,
    oppositeCandleSignal,
    otcInsight,
    summaryMarkdown,
    fusionBullets,
  };
}
