import { resolveApiPath } from "./apiPaths";

/** Backend base URL from admin/.env (VITE_BACKEND_URL). Required for Vercel → Render. */
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
