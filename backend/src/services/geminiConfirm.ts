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
    reasons: c.reasons.slice(0, 5),
  }));

  const prompt = `You are an elite ${marketType} 1-minute binary-options signal gatekeeper (Quotex, 1-step MTG).

Validate engine candidates for NEXT 1-minute candle only. Be STRICT — quality over quantity.

Approve ONLY when:
- Liquidity sweep (BSL/SSL) + wick rejection align with direction, OR
- Opposite-candle reversal + SMC/MMXM agree on next candle, OR
- 3+ engine reasons align (momentum + MSNR + rejection) with NO conflict.

Reject when:
- Choppy / ranging / conflicting momentum
- Weak snapshot-only momentum without sweep or rejection
- Direction fights opposite-candle bias
- Engine score below 70 feel

Rules:
- geminiConfidence 80+ required to approve (88+ for A+ setup)
- Approve at most ~40% of candidates — reject the rest
- Never approve all candidates blindly

Return ONLY raw JSON:
{
  "rankings": [
    { "pair": "EURUSD", "approved": true, "geminiConfidence": 86, "note": "SSL sweep + bullish rejection" }
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
        "X-Title": "Nexus AI Signals",
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
