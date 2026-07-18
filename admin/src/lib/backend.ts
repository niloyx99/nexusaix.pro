import { resolveApiPath } from "./apiPaths";

/** Production fallback so Vercel never talks to itself if env is missing. */
const DEFAULT_PROD_BACKEND = "https://nexusaix.pro";

/**
 * VITE_BACKEND_URL must be the site origin only, e.g. https://nexusaix.pro
 * If someone pastes https://nexusaix.pro/api.ai we strip the API suffix
 * so paths don't become /api.ai/api.ai/...
 */
function normalizeBackendOrigin(raw: string): string {
  let url = raw.trim().replace(/\/$/, "");
  url = url.replace(/\/api\.ai$/i, "").replace(/\/api$/i, "");
  return url.replace(/\/$/, "");
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
