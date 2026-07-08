import type { License } from "../types";

const SESSION_KEY = "nexus_admin_session";
const PASSWORD_KEY = "nexus_admin_password";
const LICENSES_KEY = "nexus_admin_licenses";

export function isAdminLoggedIn(): boolean {
  return sessionStorage.getItem(SESSION_KEY) === "authenticated";
}

export function getAdminPassword(): string {
  return sessionStorage.getItem(PASSWORD_KEY) ?? "";
}

export function adminLogin(password: string): boolean {
  sessionStorage.setItem(SESSION_KEY, "authenticated");
  sessionStorage.setItem(PASSWORD_KEY, password);
  return true;
}

export function adminLogout(): void {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(PASSWORD_KEY);
}

/** One-time migration from old browser-only storage */
export function loadLegacyLicenses(): License[] {
  try {
    const raw = localStorage.getItem(LICENSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed.map((row) => {
      const lic = row as unknown as License & { status?: string };
      const rawStatus = String(lic.status || "active");
      const status: License["status"] =
        rawStatus === "revoked" || rawStatus === "blocked" ? "blocked" : "active";
      return { ...lic, status } as License;
    });
  } catch {
    return [];
  }
}

export function clearLegacyLicenses(): void {
  localStorage.removeItem(LICENSES_KEY);
}

export function generateLicenseKey(): string {
  const segment = () =>
    Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return `NEXUS-${segment()}-${segment()}-${segment()}`;
}
