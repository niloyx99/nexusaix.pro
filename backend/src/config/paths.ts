/** Public API mount path. Prefer /api-ai (dot in /api.ai breaks some browsers/adblockers). */
export const API_PREFIX = "/api-ai";
/** Legacy branded alias (may be blocked by some clients). */
export const API_PREFIX_DOT = "/api.ai";
/** Older clients. */
export const LEGACY_API_PREFIX = "/api";
export const HEALTH_PATH = `${API_PREFIX}/health`;
