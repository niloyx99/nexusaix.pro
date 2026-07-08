/** Backend base URL from frontend/.env — empty = same origin (e.g. UI served by backend). */
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return BACKEND_URL ? `${BACKEND_URL}${normalized}` : normalized;
}

export function getBackendUrl(): string {
  return BACKEND_URL;
}
