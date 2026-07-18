/** Preferred public API prefix (avoid /api.ai — dot paths break some browsers). */
export const API_PREFIX = "/api-ai";

export function resolveApiPath(path: string): string {
  let normalized = path.startsWith("/") ? path : `/${path}`;

  if (normalized === API_PREFIX || normalized.startsWith(`${API_PREFIX}/`)) {
    return normalized;
  }

  if (normalized === "/api.ai" || normalized.startsWith("/api.ai/")) {
    return `${API_PREFIX}${normalized.slice("/api.ai".length)}`;
  }

  if (normalized === "/api" || normalized.startsWith("/api/")) {
    return `${API_PREFIX}${normalized.slice(4)}`;
  }

  while (normalized.startsWith(`${API_PREFIX}${API_PREFIX}`)) {
    normalized = normalized.slice(API_PREFIX.length);
  }

  return normalized;
}
