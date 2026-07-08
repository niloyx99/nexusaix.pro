const LOCAL_ORIGINS = [
  "http://localhost:7777",
  "http://127.0.0.1:7777",
  "http://localhost:8889",
  "http://127.0.0.1:8889",
  "http://localhost:8890",
  "http://127.0.0.1:8890",
];

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
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
  const fromEnv = parseOriginList(
    process.env.CORS_ORIGINS,
    process.env.FRONTEND_URL,
    process.env.ADMIN_URL,
    process.env.BACKEND_URL,
    process.env.RENDER_EXTERNAL_URL
  );

  return [...new Set([...fromEnv, ...LOCAL_ORIGINS])];
}

export function isAllowedOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  const allowed = getAllowedOrigins();
  if (allowed.includes(normalized)) return true;
  if (/^http:\/\/192\.168\.\d+\.\d+:(7777|8889|8890)$/.test(normalized)) return true;

  if (process.env.NODE_ENV !== "production") {
    try {
      const { hostname } = new URL(normalized);
      if (hostname.endsWith(".onrender.com")) return true;
    } catch {
      return false;
    }
  }

  return false;
}
