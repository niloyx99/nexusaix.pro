const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

function openRouterReferer(): string {
  const raw = process.env.FRONTEND_URL || "http://localhost:8889";
  return raw.split(",")[0].trim().replace(/\/$/, "") || "http://localhost:8889";
}

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

/**
 * Gemini gate for Future Signals — validates OI / Liquidation / Funding / VP / VWAP confluence.
 */
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
    reasons: c.reasons.slice(0, 6),
  }));

  const prompt = `You are an elite ${marketType} 1-minute Future Signal gatekeeper (Quotex binary, next candle only).

Engine already scored each candidate with:
Open Interest · Liquidation Data · Funding Rate · Volume Profile · VWAP (+ RSI/EMA/MACD).

Validate STRICTLY using those futures layers. Quality over quantity.

Approve ONLY when reasons show clear confluence, e.g.:
- VWAP reclaim/bounce (CALL) or VWAP lose/reject (PUT) aligned with direction, OR
- Liquidation flush (long liq bounce / short liq drop) + Volume Profile POC/VAH/VAL agree, OR
- Open Interest build + Funding / premium bias agree with direction, OR
- 3+ futures-layer reasons align with NO conflict.

Reject when:
- Conflicting OI vs Funding vs VWAP
- Weak / single-layer only
- Choppy value-area chop without break or rejection
- Engine score feels below ~62–65

Rules:
- geminiConfidence 78+ to approve (86+ for A+ setup)
- Approve at most ~45% of candidates
- Never approve all blindly
- Note must cite which futures layer(s) you used (OI / Liq / Funding / VP / VWAP)

Return ONLY raw JSON:
{
  "rankings": [
    { "pair": "EURUSD", "approved": true, "geminiConfidence": 86, "note": "VWAP reclaim + POC hold + OI longs" }
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
        "HTTP-Referer": openRouterReferer(),
        "X-Title": "Nexus AI Future Signals",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 1400,
        temperature: 0.08,
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
