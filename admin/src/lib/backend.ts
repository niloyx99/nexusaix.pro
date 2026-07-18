import { API_PREFIX, resolveApiPath } from "./apiPaths";

/** Production fallback — site origin only (no /api.ai). */
const DEFAULT_PROD_BACKEND = "https://nexusaix.pro";

/**
 * VITE_BACKEND_URL = https://nexusaix.pro
 * If /api.ai is pasted, strip it so paths don't double.
 */
function normalizeBackendOrigin(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  // Strip repeated /api.ai or /api suffixes
  for (let i = 0; i < 5; i++) {
    const next = url.replace(/\/api\.ai$/i, "").replace(/\/api$/i, "");
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

/** Origin only — for display / env checks. */
export function getBackendUrl(): string {
  return BACKEND_URL;
}

/** Full API root shown on login, e.g. https://nexusaix.pro/api.ai */
export function getApiRootUrl(): string {
  return `${BACKEND_URL}${API_PREFIX}`;
}
