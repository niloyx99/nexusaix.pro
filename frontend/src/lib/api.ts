/** Backend base URL from frontend/.env (VITE_BACKEND_URL). Required for split hosting. */
import { resolveApiPath } from "./apiPaths";

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  const normalized = resolveApiPath(path);
  if (!BACKEND_URL) {
    console.warn("VITE_BACKEND_URL is empty — API calls use same origin.");
  }
  return BACKEND_URL ? `${BACKEND_URL}${normalized}` : normalized;
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