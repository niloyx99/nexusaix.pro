import { resolveApiPath } from "./apiPaths";

/** Production fallback so Vercel never talks to itself if env is missing. */
const DEFAULT_PROD_BACKEND = "https://nexusaix-pro-backend.onrender.com";

const BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL ||
  (import.meta.env.PROD ? DEFAULT_PROD_BACKEND : "http://localhost:7777")
).replace(/\/$/, "");

export function apiUrl(path: string): string {
  const normalized = resolveApiPath(path);
  return `${BACKEND_URL}${normalized}`;
}

export function getBackendUrl(): string {
  return BACKEND_URL;
}
