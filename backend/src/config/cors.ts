/**
 * CORS origins from backend/.env:
 *   FRONTEND_URL — content site (Hostinger / local :8889)
 *   ADMIN_URL    — admin panel (Vercel / local :8890)
 */
const LOCAL_ORIGINS = [
  "http://localhost:8889",
  "http://127.0.0.1:8889",
  "http://localhost:8890",
  "http://127.0.0.1:8890",
];

function normalizeOrigin(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return trimmed;
  }
}

function parseOriginList(...values: (string | undefined)[]): string[] {
  const origins = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    for (const part of value.split(",")) {
      const normalized = normalizeOrigin(part);
      if (normalized) origins.add(normalized);
    }
  }
  return [...origins];
}

export function getAllowedOrigins(): string[] {
  const fromEnv = parseOriginList(process.env.FRONTEND_URL, process.env.ADMIN_URL);
  // Always allow local Vite ports so `npm run dev` works even when
  // FRONTEND_URL/ADMIN_URL are set to hosted domains only.
  return [...new Set([...fromEnv, ...LOCAL_ORIGINS])];
}

export function isAllowedOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const allowed = getAllowedOrigins();
  if (allowed.includes(normalized)) return true;

  if (/^https?:\/\/192\.168\.\d+\.\d+:(8889|8890)$/.test(normalized)) {
    return true;
  }

  try {
    const { hostname, protocol } = new URL(normalized);
    if (protocol !== "https:" && protocol !== "http:") return false;

    for (const entry of allowed) {
      try {
        const allowedHost = new URL(entry).hostname;
        if (
          hostname === allowedHost ||
          hostname === `www.${allowedHost}` ||
          `www.${hostname}` === allowedHost
        ) {
          return true;
        }
      } catch {
        /* ignore */
      }
    }

    // Allow Vercel preview hosts when ADMIN_URL is on vercel.app
    if (hostname.endsWith(".vercel.app")) {
      const adminHosts = parseOriginList(process.env.ADMIN_URL).map((o) => {
        try {
          return new URL(o).hostname;
        } catch {
          return "";
        }
      });
      if (adminHosts.some((h) => h.endsWith(".vercel.app"))) return true;
    }
  } catch {
    return false;
  }

  return false;
}
