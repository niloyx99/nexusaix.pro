import type { License } from "../types";
import { clearLegacyLicenses, getAdminPassword, loadLegacyLicenses } from "./storage";
import { apiUrl, getBackendUrl } from "./backend";

function assertJsonResponse(res: Response): void {
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new Error(
      `Backend returned non-JSON (${res.status}). Check VITE_BACKEND_URL=${getBackendUrl()}`
    );
  }
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const password = getAdminPassword();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (password) headers.set("X-Admin-Password", password);

  const res = await fetch(apiUrl(`/api/admin/licenses${path}`), {
    ...init,
    headers,
  });

  assertJsonResponse(res);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchLicenses(): Promise<License[]> {
  const data = await adminFetch<{ licenses: License[] }>("/");
  if (!Array.isArray(data.licenses)) {
    throw new Error("Invalid license list from backend.");
  }
  return data.licenses;
}

export async function migrateLegacyLicensesIfNeeded(): Promise<void> {
  const legacy = loadLegacyLicenses();
  if (legacy.length === 0) return;

  const existing = await fetchLicenses();
  if (existing.length > 0) {
    clearLegacyLicenses();
    return;
  }

  for (const license of legacy) {
    await adminFetch<{ license: License }>("/", {
      method: "POST",
      body: JSON.stringify({
        key: license.key,
        tier: license.tier,
        holderName: license.holderName,
        holderTelegram: license.holderTelegram,
        note: license.note,
        dailyLimit: license.dailyLimit,
      }),
    });
  }
  clearLegacyLicenses();
}

export async function createLicenseApi(
  license: Omit<License, "id" | "createdAt" | "status"> & { key: string }
): Promise<License> {
  const data = await adminFetch<{ license: License }>("/", {
    method: "POST",
    body: JSON.stringify({
      key: license.key,
      tier: license.tier,
      holderName: license.holderName,
      holderTelegram: license.holderTelegram,
      note: license.note,
      dailyLimit: license.dailyLimit,
      deviceLimit: license.deviceLimit ?? 1,
    }),
  });
  return data.license;
}

export async function updateLicenseApi(
  id: string,
  patch: {
    tier?: License["tier"];
    holderTelegram?: string;
    holderName?: string;
    note?: string;
    dailyLimit?: number;
    deviceLimit?: number;
    status?: "active" | "blocked";
  }
): Promise<License> {
  const data = await adminFetch<{ license: License }>(`/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.license;
}

export async function updateLicenseStatusApi(
  id: string,
  status: "active" | "blocked"
): Promise<License> {
  const data = await adminFetch<{ license: License }>(`/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return data.license;
}

export async function deleteLicenseApi(id: string): Promise<void> {
  await adminFetch<{ success: boolean }>(`/${id}`, { method: "DELETE" });
}

export async function resetLicenseDeviceApi(id: string): Promise<License> {
  const data = await adminFetch<{ license: License }>(`/${id}/reset-device`, {
    method: "POST",
  });
  return data.license;
}

/** Returns true only when backend accepts this password with a real JSON API response. */
export async function verifyAdminPassword(password: string): Promise<boolean> {
  const trimmed = password.trim();
  if (!trimmed) return false;

  const res = await fetch(apiUrl("/api/admin/licenses/"), {
    headers: {
      "X-Admin-Password": trimmed,
      Accept: "application/json",
    },
  });

  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new Error(`Not connected to API at ${getBackendUrl()}`);
  }

  if (res.status === 401) return false;
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Backend error (${res.status})`);
  }

  const data = (await res.json().catch(() => null)) as { licenses?: unknown } | null;
  if (!data || !Array.isArray(data.licenses)) {
    throw new Error("Invalid admin API response.");
  }
  return true;
}
