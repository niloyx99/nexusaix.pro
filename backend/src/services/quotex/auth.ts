import fs from "fs";
import path from "path";
import {
  QUOTEX_BASE_URL,
  QUOTEX_IS_DEMO,
  QUOTEX_SESSION_FILE,
  buildSsid,
  getQuotexCredentials,
} from "./config.js";
import type { QuotexSession } from "./types.js";

function ensureSessionDir() {
  const dir = path.dirname(QUOTEX_SESSION_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadQuotexSession(): QuotexSession | null {
  try {
    if (!fs.existsSync(QUOTEX_SESSION_FILE)) return null;
    return JSON.parse(fs.readFileSync(QUOTEX_SESSION_FILE, "utf-8")) as QuotexSession;
  } catch {
    return null;
  }
}

export function saveQuotexSession(session: QuotexSession): void {
  ensureSessionDir();
  fs.writeFileSync(QUOTEX_SESSION_FILE, JSON.stringify(session, null, 2), "utf-8");
}

function extractCsrfToken(html: string): string | null {
  const match =
    html.match(/name="_token"\s+value="([^"]+)"/) ||
    html.match(/window\.settings\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return null;
  if (match[1].startsWith("{")) {
    try {
      const settings = JSON.parse(match[1]);
      return settings.csrf || null;
    } catch {
      return null;
    }
  }
  return match[1];
}

function extractTokenFromTradePage(html: string): string | null {
  const match = html.match(/window\.settings\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return null;
  try {
    const settings = JSON.parse(match[1]);
    return settings.token || null;
  } catch {
    return null;
  }
}

function parseCookieHeader(setCookie: string[] | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const item of setCookie || []) {
    const part = item.split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) {
      cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return cookies;
}

function mergeCookies(
  jar: Record<string, string>,
  response: Response
): Record<string, string> {
  const next = { ...jar };
  const raw = response.headers.getSetCookie?.() || [];
  for (const [key, value] of Object.entries(parseCookieHeader(raw))) {
    next[key] = value;
  }
  return next;
}

function cookieString(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function findSessionId(
  cookies: Record<string, string>,
  token?: string | null
): string | null {
  for (const key of ["session", "ssid", "qx_session", "laravel_session"]) {
    if (cookies[key]) return cookies[key];
  }
  return token || null;
}

export async function loginToQuotex(): Promise<QuotexSession> {
  const { email, password, lang, isDemo } = getQuotexCredentials();
  if (!email || !password) {
    throw new Error("QUOTEX_EMAIL and QUOTEX_PASSWORD are required in backend/.env");
  }

  const loginUrl = `${QUOTEX_BASE_URL}/${lang}/sign-in/`;
  const targetUrl = isDemo
    ? `${QUOTEX_BASE_URL}/${lang}/demo-trade`
    : `${QUOTEX_BASE_URL}/${lang}/trade`;

  let cookies: Record<string, string> = {};
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  const signInPage = await fetch(loginUrl, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!signInPage.ok) {
    throw new Error(`Quotex sign-in page failed (${signInPage.status})`);
  }

  cookies = mergeCookies(cookies, signInPage);
  const html = await signInPage.text();
  const csrf = extractCsrfToken(html);
  if (!csrf) {
    throw new Error("Could not read Quotex CSRF token from sign-in page");
  }

  const body = new URLSearchParams({
    _token: csrf,
    email,
    password,
    remember: "1",
  });

  const loginResponse = await fetch(`${QUOTEX_BASE_URL}/${lang}/sign-in/`, {
    method: "POST",
    headers: {
      "User-Agent": userAgent,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: loginUrl,
      Cookie: cookieString(cookies),
    },
    body,
    redirect: "manual",
  });

  cookies = mergeCookies(cookies, loginResponse);

  const redirect = loginResponse.headers.get("location");
  if (redirect) {
    const nextUrl = redirect.startsWith("http")
      ? redirect
      : `${QUOTEX_BASE_URL}${redirect}`;
    const follow = await fetch(nextUrl, {
      headers: {
        "User-Agent": userAgent,
        Cookie: cookieString(cookies),
        Referer: loginUrl,
      },
      redirect: "follow",
    });
    cookies = mergeCookies(cookies, follow);
  }

  const tradePage = await fetch(targetUrl, {
    headers: {
      "User-Agent": userAgent,
      Cookie: cookieString(cookies),
      Referer: loginUrl,
    },
  });

  if (!tradePage.ok) {
    throw new Error(`Quotex trade page failed (${tradePage.status})`);
  }

  cookies = mergeCookies(cookies, tradePage);
  const tradeHtml = await tradePage.text();
  const token = extractTokenFromTradePage(tradeHtml);
  const sessionId = findSessionId(cookies, token);

  if (!sessionId) {
    throw new Error("Quotex login succeeded but session token was not found");
  }

  const session: QuotexSession = {
    token: token || undefined,
    sessionId,
    cookies: cookieString(cookies),
    userAgent,
    isDemo: QUOTEX_IS_DEMO,
    ssid: buildSsid(sessionId, QUOTEX_IS_DEMO),
    savedAt: new Date().toISOString(),
  };

  saveQuotexSession(session);
  return session;
}

export async function getOrCreateQuotexSession(): Promise<QuotexSession> {
  const saved = loadQuotexSession();
  if (saved?.ssid && saved.sessionId) {
    return saved;
  }
  return loginToQuotex();
}
