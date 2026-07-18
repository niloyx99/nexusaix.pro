/** Public API prefix on Hostinger. */
export const API_PREFIX = "/api.ai";

/**
 * Normalize any path to /api.ai/...
 * Never doubles the prefix (fixes /api.ai/api.ai/...).
 */
export function resolveApiPath(path: string): string {
  let normalized = path.startsWith("/") ? path : `/${path}`;

  // Already on the public prefix
  if (normalized === API_PREFIX || normalized.startsWith(`${API_PREFIX}/`)) {
    return normalized;
  }

  // Legacy /api → /api.ai
  if (normalized === "/api" || normalized.startsWith("/api/")) {
    normalized = `${API_PREFIX}${normalized.slice(4)}`;
  }

  // Collapse accidental doubles
  while (normalized.startsWith(`${API_PREFIX}${API_PREFIX}`)) {
    normalized = normalized.slice(API_PREFIX.length);
  }

  return normalized;
}
