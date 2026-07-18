import { API_PREFIX, resolveApiPath } from "./apiPaths";

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
  return `${BACKEND_URL}${resolveApiPath(path)}`;
}

export function getBackendUrl(): string {
  return BACKEND_URL;
}

/** Full API root, e.g. https://nexusaix.pro/api-ai */
export function getApiRootUrl(): string {
  return `${BACKEND_URL}${API_PREFIX}`;
}
