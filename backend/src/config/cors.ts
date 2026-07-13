/**
 * CORS origins come from backend/.env:
 *   FRONTEND_URL  — Hostinger / local Vite (8889)
 *   ADMIN_URL     — Vercel / local Vite (8890)
 *   CORS_ORIGINS  — optional extra origins (comma-separated)
 *   BACKEND_URL   — this API's public URL (Render / local 7777)
 */
const LOCAL_ORIGINS = [
  "http://localhost:7777",
  "http://127.0.0.1:7777",
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
  // Frontend + Admin URLs are the primary allowed browser origins.
  const fromEnv = parseOriginList(
    process.env.FRONTEND_URL,
    process.env.ADMIN_URL,
    process.env.CORS_ORIGINS,
    process.env.BACKEND_URL,
    process.env.RENDER_EXTERNAL_URL
  );

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    return [...new Set(fromEnv)];
  }

  return [...new Set([...fromEnv, ...LOCAL_ORIGINS])];
}

export function isAllowedOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const allowed = getAllowedOrigins();
  if (allowed.includes(normalized)) return true;

  // LAN testing during local dev
  if (/^https?:\/\/192\.168\.\d+\.\d+:(7777|8889|8890)$/.test(normalized)) {
    return true;
  }

  try {
    const { hostname, protocol } = new URL(normalized);
    if (protocol !== "https:" && protocol !== "http:") return false;

    // www ↔ apex for configured frontend/admin hosts
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
        /* ignore bad entries */
      }
    }

    // Vercel preview deployments when ADMIN_URL is a vercel.app host
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
