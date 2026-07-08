const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

export interface GeminiCandidate {
  pair: string;
  direction: "CALL" | "PUT";
  confidence: number;
  engineScore: number;
  reasons: string[];
}

export interface GeminiConfirmation {
  status: "ok" | "fallback";
  rankings: Array<{
    pair: string;
    approved: boolean;
    geminiConfidence: number;
    note: string;
  }>;
}

function getApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY || null;
}

export async function confirmSignalsWithGemini(
  candidates: GeminiCandidate[],
  marketType: "REAL" | "OTC"
): Promise<GeminiConfirmation> {
  const apiKey = getApiKey();
  if (!apiKey || candidates.length === 0) {
    return { status: "fallback", rankings: [] };
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const payload = candidates.map((c) => ({
    pair: c.pair,
    direction: c.direction,
    engineConfidence: c.confidence,
    engineScore: c.engineScore,
    reasons: c.reasons.slice(0, 4),
  }));

  const prompt = `You are an elite ${marketType} binary-options signal validator using Daisy Chain confirmation (multi-layer SMC + MSNR + MMXM + price action + parallel pair quality).

Review these live-engine candidates and confirm which deserve 1-minute CALL/PUT signals.
Rules:
- Approve when liquidity sweep + wick rejection align OR 2+ engine confirmations agree.
- Reject choppy / conflicting / weak setups.
- geminiConfidence 72+ to approve; 82+ for premium.
- Prefer setups where engine reasons mention wick rejection or opposite-candle next direction.

Return ONLY raw JSON:
{
  "rankings": [
    { "pair": "EURUSD_otc", "approved": true, "geminiConfidence": 88, "note": "short reason" }
  ]
}

Candidates:
${JSON.stringify(payload, null, 2)}`;

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.FRONTEND_URL || "http://localhost:8889",
        "X-Title": "Aldi Bot Signals",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 1200,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      return { status: "fallback", rankings: [] };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { status: "fallback", rankings: [] };

    const parsed = JSON.parse(
      content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    ) as { rankings?: GeminiConfirmation["rankings"] };

    return {
      status: "ok",
      rankings: parsed.rankings ?? [],
    };
  } catch {
    return { status: "fallback", rankings: [] };
  }
}
