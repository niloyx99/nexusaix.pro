export const API_PREFIX = (import.meta.env.VITE_API_PREFIX || "/nx-svc-k8m4t7q2w9p3").replace(/\/$/, "");

export function resolveApiPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (p.startsWith("/api/")) return `${API_PREFIX}${p.slice(4)}`;
  if (p === "/api") return API_PREFIX;
  return p;
}
