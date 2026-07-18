/** Backend base URL from Vite env. Local + Hostinger both work. */
import { resolveApiPath } from "./apiPaths";

const DEFAULT_PROD_BACKEND = "https://nexusaix.pro";

function normalizeBackendOrigin(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  for (let i = 0; i < 5; i++) {
    const next = url
      .replace(/\/api-ai$/i, "")
      .replace(/\/api\.ai$/i, "")
      .replace(/\/api$/i, "");
    if (next === url) break;
    url = next.replace(/\/+$/, "");
  }
  return url;
}

const BACKEND_URL = normalizeBackendOrigin(
  import.meta.env.VITE_BACKEND_URL ||
    (import.meta.env.PROD ? DEFAULT_PROD_BACKEND : "http://localhost:7777")
);

export function apiUrl(path: string): string {
  const normalized = resolveApiPath(path);
  return `${BACKEND_URL}${normalized}`;
}

export function getBackendUrl(): string {
  return BACKEND_URL;
}

const RETRY_STATUSES = new Set([403, 429, 502, 503, 504]);

/** Retry transient server/WAF blocks (common on shared hosting under load). */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retries = 2
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (RETRY_STATUSES.has(res.status) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Network request failed");
}
