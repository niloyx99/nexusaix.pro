import type { License } from "../types";
import { clearLegacyLicenses, getAdminPassword, loadLegacyLicenses } from "./storage";
import { apiUrl } from "./backend";

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const password = getAdminPassword();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (password) headers.set("X-Admin-Password", password);

  const res = await fetch(apiUrl(`/api/admin/licenses${path}`), {
    ...init,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchLicenses(): Promise<License[]> {
  const data = await adminFetch<{ licenses: License[] }>("/");
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

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const res = await fetch(apiUrl("/api/admin/licenses/"), {
    headers: {
      "X-Admin-Password": password,
    },
  });
  return res.ok;
}
