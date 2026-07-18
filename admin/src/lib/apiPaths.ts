/** Map legacy /api/* calls to public API prefix /api.ai/* */
export function resolveApiPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/api" || normalized.startsWith("/api/")) {
    return `/api.ai${normalized.slice(4)}`;
  }
  return normalized;
}
