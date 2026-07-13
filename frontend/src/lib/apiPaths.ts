/** Keep /api paths as-is (backend is API-only under /api). */
export function resolveApiPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
