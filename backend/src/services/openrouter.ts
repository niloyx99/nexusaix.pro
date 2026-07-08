export interface AnalysisResult {
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  winRatePct: number;
  winRateVal: string;
  supportVal: string;
  supportPct: number;
  resistanceVal: string;
  resistancePct: number;
  signalQualityVal: string;
  signalQualityPct: number;
  analysisTitle: string;
  marketType: "REAL" | "OTC";
  analysisText: string;
  recommendation: "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL";
}

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

const ANALYSIS_PROMPT = `You are an elite 1-minute binary-options chart analyst (Quotex OTC + REAL, MT4/MT5 screenshots).

Analyze the chart for the **NEXT 1-minute candle only** — not long-term trend.

Method (priority order):
1. **Last closed candle** — wick rejection, engulfing, displacement, opposite-side grab.
2. **SMC** — BSL/SSL liquidity sweep (wick beyond swing then close back inside).
3. **MMXM** — manipulation sweep then expansion in reversal direction.
4. **MSNR** — fresh S/R from candle bodies, SBR/RBS flips, rejection wicks.
5. **OTC rule** — after opposite/manipulation candle, next candle often expands that reversal direction. Do NOT chase mid-range chop.

Critical rules:
- If chart is choppy/unclear → trend NEUTRAL, recommendation HOLD, winRatePct under 60.
- Only give winRatePct 75+ when last candle + structure clearly agree on NEXT candle direction.
- For MT4/MT5: read the pair from chart title; detect OTC from "(OTC)" or synthetic labels.
- recommendation maps to next candle: BUY/CALL = up, SELL/PUT = down, HOLD = no clear edge.

Return ONLY raw JSON (no markdown fences):
{
  "trend": "BULLISH" | "BEARISH" | "NEUTRAL",
  "winRatePct": integer 45-92,
  "winRateVal": "e.g. '78% WIN RATE'",
  "supportVal": "key support price or zone",
  "supportPct": integer 1-100,
  "resistanceVal": "key resistance price or zone",
  "resistancePct": integer 1-100,
  "signalQualityVal": "STRONG | EXCELLENT | MEDIUM | LOW",
  "signalQualityPct": integer 1-100,
  "analysisTitle": "pair only e.g. 'EUR/USD' — no OTC/REAL suffix",
  "marketType": "REAL" | "OTC",
  "analysisText": "markdown: ### Chart Structure, ### Last Candle Signal, ### SMC & Liquidity, ### Next 1-Min Candle Bias, ### Entry Trigger",
  "recommendation": "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL"
}
Keep analysisText under 280 words. Be conservative — wrong direction loses the trade.`;

function getApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.warn("OPENROUTER_API_KEY is not defined. Using fallback analysis.");
    return null;
  }
  return key;
}

export function getFallbackAnalysis(errorReason?: string): AnalysisResult {
  const errorNote = errorReason
    ? `\n\n*(Simulation mode: ${errorReason})*`
    : `\n\n*Set OPENROUTER_API_KEY in backend/.env for live analysis.*`;

  return {
    trend: "NEUTRAL",
    winRatePct: 50,
    winRateVal: "50% WIN RATE",
    supportVal: "—",
    supportPct: 50,
    resistanceVal: "—",
    resistancePct: 50,
    signalQualityVal: "LOW",
    signalQualityPct: 45,
    analysisTitle: "Unknown Pair",
    marketType: "OTC",
    analysisText: `### Analysis Unavailable\n\n* Live AI analysis could not run. **Do not trade** on this result.\n* Re-upload your chart or check OPENROUTER_API_KEY.${errorNote}`,
    recommendation: "HOLD",
  };
}

function normalizeMarketType(value: unknown, title?: string): "REAL" | "OTC" {
  const raw = String(value || "").toUpperCase();
  if (raw === "OTC") return "OTC";
  if (raw === "REAL") return "REAL";
  const fromTitle = (title || "").toUpperCase();
  if (fromTitle.includes("OTC")) return "OTC";
  return "REAL";
}

function normalizeAnalysisResult(data: AnalysisResult): AnalysisResult {
  const cleanTitle = (data.analysisTitle || "")
    .replace(/\s*\(OTC\)/gi, "")
    .replace(/\s*\(REAL\)/gi, "")
    .trim();

  return {
    ...data,
    analysisTitle: cleanTitle,
    marketType: normalizeMarketType(data.marketType, data.analysisTitle),
  };
}

function parseJsonResponse(text: string): AnalysisResult {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return normalizeAnalysisResult(JSON.parse(cleaned) as AnalysisResult);
}

export async function analyzeChartImage(image: string): Promise<AnalysisResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return getFallbackAnalysis();
  }

  const imageUrl = image.startsWith("data:") ? image : `data:image/png;base64,${image}`;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:8888",
        "X-Title": "Aldi Bot",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUrl } },
              { type: "text", text: ANALYSIS_PROMPT },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 900,
        temperature: 0.15,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errBody.slice(0, 120)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("No content returned from model");
    }

    return parseJsonResponse(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "API connection issue";
    const shortError = message.length > 80 ? message.slice(0, 80) + "..." : message;
    console.log(`OpenRouter (${model}) unavailable, using fallback.`);
    return getFallbackAnalysis(shortError);
  }
}
