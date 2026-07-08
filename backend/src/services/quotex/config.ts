import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const QUOTEX_BASE_URL = "https://qxbroker.com";
export const QUOTEX_LANG = process.env.QUOTEX_LANG || "en";
export const QUOTEX_IS_DEMO = process.env.QUOTEX_ACCOUNT_TYPE !== "live";

export const QUOTEX_WS_URLS = [
  "wss://ws2.qxbroker.com/socket.io/?EIO=3&transport=websocket",
  "wss://ws.qxbroker.com/socket.io/?EIO=3&transport=websocket",
];

export const QUOTEX_SESSION_FILE = path.join(
  __dirname,
  "../../../data/quotex-session.json"
);

export function getQuotexCredentials() {
  return {
    email: process.env.QUOTEX_EMAIL?.trim() || "",
    password: process.env.QUOTEX_PASSWORD || "",
    isDemo: QUOTEX_IS_DEMO,
    lang: QUOTEX_LANG,
  };
}

export function hasQuotexCredentials(): boolean {
  const { email, password } = getQuotexCredentials();
  return Boolean(email && password);
}

export function buildSsid(sessionId: string, isDemo: boolean): string {
  return `42["authorization",{"session":"${sessionId}","isDemo":${isDemo ? 1 : 0},"tournamentId":0}]`;
}
