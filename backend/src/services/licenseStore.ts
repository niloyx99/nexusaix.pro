import type { License, LicenseUsageRecord } from "../types/license.js";
import { COLLECTIONS, getCollection } from "../db/mongo.js";
import {
  TIER_DAILY_LIMITS,
  UNLIMITED_DAILY_LIMIT,
  UNLIMITED_DEVICE_LIMIT,
} from "../types/license.js";
import type {
  LicenseTier,
  ValidateLicenseBody,
  ValidateLicenseResponse,
  DeviceBinding,
} from "../types/license.js";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeKey(key: string): string {
  return key.trim().toUpperCase();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeTelegram(telegram: string): string {
  const t = telegram.trim();
  if (!t) return "";
  return t.startsWith("@") ? t.toLowerCase() : `@${t.toLowerCase()}`;
}

export function generateLicenseKey(): string {
  const segment = () =>
    Math.random()
      .toString(36)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);
  return `NEXUS-${segment()}-${segment()}-${segment()}`;
}

export function getDailyLimitForTier(tier: LicenseTier): number {
  return TIER_DAILY_LIMITS[tier];
}

export function isUnlimitedDaily(dailyLimit: number): boolean {
  return dailyLimit < 0;
}

export function isUnlimitedDevices(deviceLimit: number): boolean {
  return deviceLimit < 0;
}

export function formatDailyLimit(dailyLimit: number): string {
  return isUnlimitedDaily(dailyLimit) ? "Unlimited" : String(dailyLimit);
}

export function formatDeviceLimit(deviceLimit: number): string {
  return isUnlimitedDevices(deviceLimit) ? "Unlimited" : String(deviceLimit);
}

function normalizeLicense(lic: License): License {
  const deviceLimit = lic.deviceLimit ?? 1;
  let deviceBindings = lic.deviceBindings ?? [];
  if (!deviceBindings.length && lic.deviceBinding?.fingerprint) {
    deviceBindings = [lic.deviceBinding];
  }

  return {
    ...lic,
    status: lic.status === "blocked" ? "blocked" : "active",
    dailyLimit: lic.dailyLimit ?? getDailyLimitForTier(lic.tier),
    deviceLimit,
    deviceBindings,
    deviceBinding: deviceBindings[0] ?? null,
  };
}

export function getDeviceBindings(license: License): DeviceBinding[] {
  if (license.deviceBindings?.length) return license.deviceBindings;
  if (license.deviceBinding?.fingerprint) return [license.deviceBinding];
  return [];
}

export async function getAllLicenses(): Promise<License[]> {
  const col = await getCollection<License>(COLLECTIONS.licenses);
  const licenses = await col.find().sort({ createdAt: -1 }).toArray();
  return licenses.map(normalizeLicense);
}

export async function findLicenseByKey(key: string): Promise<License | null> {
  const normalized = normalizeKey(key);
  const col = await getCollection<License>(COLLECTIONS.licenses);
  const license = await col.findOne({ key: normalized });
  return license ? normalizeLicense(license) : null;
}

export async function findLicenseById(id: string): Promise<License | null> {
  const col = await getCollection<License>(COLLECTIONS.licenses);
  const license = await col.findOne({ id });
  return license ? normalizeLicense(license) : null;
}

export async function createLicense(
  input: Omit<License, "id" | "createdAt"> & { id?: string; createdAt?: string }
): Promise<License> {
  const col = await getCollection<License>(COLLECTIONS.licenses);
  const key = normalizeKey(input.key);

  const exists = await col.findOne({ key });
  if (exists) {
    throw new Error("License key already exists.");
  }

  const license: License = {
    id: input.id ?? `lic-${Date.now()}`,
    key,
    tier: input.tier,
    dailyLimit: input.dailyLimit ?? getDailyLimitForTier(input.tier),
    deviceLimit: input.deviceLimit ?? 1,
    holderName: input.holderName.trim(),
    holderEmail: normalizeEmail(input.holderEmail),
    holderTelegram: normalizeTelegram(input.holderTelegram),
    status: input.status ?? "active",
    createdAt: input.createdAt ?? new Date().toISOString(),
    note: input.note ?? "",
    deviceBindings: input.deviceBindings ?? [],
    deviceBinding: null,
  };

  await col.insertOne(license);
  return license;
}

export async function updateLicense(
  id: string,
  patch: Partial<
    Pick<
      License,
      | "status"
      | "note"
      | "tier"
      | "dailyLimit"
      | "deviceLimit"
      | "holderName"
      | "holderEmail"
      | "holderTelegram"
      | "deviceBinding"
      | "deviceBindings"
    >
  >
): Promise<License | null> {
  const current = await findLicenseById(id);
  if (!current) return null;

  const updated: License = {
    ...current,
    ...patch,
    holderName: patch.holderName?.trim() ?? current.holderName,
    holderEmail: patch.holderEmail ? normalizeEmail(patch.holderEmail) : current.holderEmail,
    holderTelegram: patch.holderTelegram
      ? normalizeTelegram(patch.holderTelegram)
      : current.holderTelegram,
    dailyLimit:
      patch.dailyLimit ??
      (patch.tier ? getDailyLimitForTier(patch.tier) : current.dailyLimit),
    deviceLimit: patch.deviceLimit ?? current.deviceLimit ?? 1,
    deviceBindings:
      patch.deviceBindings ??
      (patch.deviceBinding === null ? [] : current.deviceBindings ?? []),
    deviceBinding:
      patch.deviceBinding === null
        ? null
        : patch.deviceBindings?.[0] ?? current.deviceBinding ?? null,
  };

  const col = await getCollection<License>(COLLECTIONS.licenses);
  await col.updateOne({ id }, { $set: updated });
  return updated;
}

export async function deleteLicense(id: string): Promise<boolean> {
  const col = await getCollection<License>(COLLECTIONS.licenses);
  const result = await col.deleteOne({ id });
  return result.deletedCount > 0;
}

export async function resetLicenseDevice(id: string): Promise<License | null> {
  return updateLicense(id, { deviceBindings: [], deviceBinding: null });
}

function assertDeviceMatch(
  license: License,
  fingerprint: string
): { ok: true } | { ok: false; message: string } {
  const normalized = fingerprint.trim();
  if (!normalized || normalized.length < 12) {
    return { ok: false, message: "Device fingerprint missing. Please refresh and try again." };
  }

  const bindings = getDeviceBindings(license);
  const deviceLimit = license.deviceLimit ?? 1;

  if (bindings.some((b) => b.fingerprint === normalized)) {
    return { ok: true };
  }

  if (bindings.length === 0) {
    return { ok: true };
  }

  if (isUnlimitedDevices(deviceLimit) || bindings.length < deviceLimit) {
    return { ok: true };
  }

  return {
    ok: false,
    message: `Device limit reached (${formatDeviceLimit(deviceLimit)}). Contact admin to reset devices.`,
  };
}

async function bindLicenseDevice(
  licenseId: string,
  binding: DeviceBinding
): Promise<License | null> {
  const license = await findLicenseById(licenseId);
  if (!license) return null;

  const bindings = getDeviceBindings(license);
  if (bindings.some((b) => b.fingerprint === binding.fingerprint)) {
    return license;
  }

  const deviceLimit = license.deviceLimit ?? 1;
  if (!isUnlimitedDevices(deviceLimit) && bindings.length >= deviceLimit) {
    return license;
  }

  const nextBindings = [...bindings, binding];
  return updateLicense(licenseId, {
    deviceBindings: nextBindings,
    deviceBinding: nextBindings[0] ?? null,
  });
}

export async function registerDeviceForLicense(
  license: License,
  binding: DeviceBinding
): Promise<License> {
  const updated = await bindLicenseDevice(license.id, binding);
  return updated ?? license;
}

type UsageDoc = LicenseUsageRecord & { licenseKey: string };

export async function getUsageForKey(key: string): Promise<LicenseUsageRecord> {
  const col = await getCollection<UsageDoc>(COLLECTIONS.licenseUsage);
  const normalized = normalizeKey(key);
  const record = await col.findOne({ licenseKey: normalized });
  const today = todayKey();

  if (!record || record.date !== today) {
    const totalScans = record?.totalScans ?? record?.count ?? 0;
    return { date: today, count: 0, totalScans };
  }
  return {
    date: record.date,
    count: record.count,
    totalScans: record.totalScans ?? record.count ?? 0,
  };
}

export async function getRemainingUsage(
  key: string,
  dailyLimit: number
): Promise<{ usedToday: number; remaining: number; totalScans: number }> {
  const usage = await getUsageForKey(key);
  const usedToday = usage.count;
  const totalScans = usage.totalScans;
  if (isUnlimitedDaily(dailyLimit)) {
    return { usedToday, remaining: UNLIMITED_DAILY_LIMIT, totalScans };
  }
  return {
    usedToday,
    remaining: Math.max(0, dailyLimit - usedToday),
    totalScans,
  };
}

export async function incrementUsage(
  key: string,
  amount = 1
): Promise<LicenseUsageRecord> {
  const col = await getCollection<UsageDoc>(COLLECTIONS.licenseUsage);
  const normalized = normalizeKey(key);
  const today = todayKey();
  const current = await col.findOne({ licenseKey: normalized });
  const prevTotal = current?.totalScans ?? current?.count ?? 0;
  const next: LicenseUsageRecord =
    !current || current.date !== today
      ? { date: today, count: amount, totalScans: prevTotal + amount }
      : {
          date: today,
          count: current.count + amount,
          totalScans: prevTotal + amount,
        };

  await col.updateOne(
    { licenseKey: normalized },
    { $set: { licenseKey: normalized, ...next } },
    { upsert: true }
  );
  return next;
}

export async function validateLicense(
  body: ValidateLicenseBody
): Promise<ValidateLicenseResponse> {
  const key = normalizeKey(body.key);
  const telegram = normalizeTelegram(body.telegram);
  const fingerprint = String(body.deviceFingerprint || "").trim();
  const ip = String(body.ip || "unknown").trim();
  const userAgent = String(body.userAgent || "").trim();

  if (!key || !telegram) {
    return { valid: false, message: "License key and username are required." };
  }

  const license = await findLicenseByKey(key);
  if (!license) {
    return { valid: false, message: "Invalid license key." };
  }

  if (license.status === "blocked") {
    return { valid: false, message: "This license has been blocked. Contact support." };
  }

  if (license.holderTelegram !== telegram) {
    return { valid: false, message: "Username does not match this license." };
  }

  const deviceCheck = assertDeviceMatch(license, fingerprint);
  if (!deviceCheck.ok) {
    return { valid: false, message: deviceCheck.message };
  }

  if (!license.deviceBinding?.fingerprint && !getDeviceBindings(license).length && fingerprint) {
    await bindLicenseDevice(license.id, {
      fingerprint,
      ip,
      userAgent,
      boundAt: new Date().toISOString(),
    });
  } else if (
    fingerprint &&
    getDeviceBindings(license).some((b) => b.fingerprint === fingerprint) === false &&
    (isUnlimitedDevices(license.deviceLimit) ||
      getDeviceBindings(license).length < (license.deviceLimit ?? 1))
  ) {
    await bindLicenseDevice(license.id, {
      fingerprint,
      ip,
      userAgent,
      boundAt: new Date().toISOString(),
    });
  }

  const refreshed = (await findLicenseByKey(key)) ?? license;
  const usage = await getRemainingUsage(refreshed.key, refreshed.dailyLimit);
  const devicesUsed = getDeviceBindings(refreshed).length;

  return {
    valid: true,
    license: {
      key: refreshed.key,
      tier: refreshed.tier,
      dailyLimit: refreshed.dailyLimit,
      holderName: refreshed.holderName,
      holderEmail: refreshed.holderEmail,
      holderTelegram: refreshed.holderTelegram,
      status: refreshed.status,
    },
    usage,
    deviceBound: devicesUsed > 0,
    deviceLimit: refreshed.deviceLimit,
    devicesUsed,
  };
}

async function assertLicenseEligible(
  key: string,
  incrementBy: number,
  deviceFingerprint: string
): Promise<{ license: License; remaining: Awaited<ReturnType<typeof getRemainingUsage>> }> {
  const license = await findLicenseByKey(key);
  if (!license) {
    throw Object.assign(new Error("Invalid license key."), { status: 401, code: "LICENSE_INVALID" });
  }
  if (license.status === "blocked") {
    throw Object.assign(new Error("License is blocked."), { status: 403, code: "LICENSE_BLOCKED" });
  }

  const deviceCheck = assertDeviceMatch(license, deviceFingerprint);
  if (!deviceCheck.ok) {
    throw Object.assign(new Error(deviceCheck.message), {
      status: 403,
      code: "DEVICE_MISMATCH",
    });
  }

  const remaining = await getRemainingUsage(license.key, license.dailyLimit);
  if (
    !isUnlimitedDaily(license.dailyLimit) &&
    remaining.remaining < incrementBy
  ) {
    throw Object.assign(
      new Error(
        `Daily limit reached (${formatDailyLimit(license.dailyLimit)}/day). Resets at midnight UTC.`
      ),
      { status: 429, usage: remaining }
    );
  }

  return { license, remaining };
}

/** Validate license + daily limit without consuming a scan (for chart analyze pre-check). */
export async function validateLicenseForRequest(
  key: string,
  deviceFingerprint = ""
): Promise<{
  license: License;
  usage: { usedToday: number; remaining: number; totalScans: number };
}> {
  const { license, remaining } = await assertLicenseEligible(key, 1, deviceFingerprint);
  return { license, usage: remaining };
}

export async function assertLicenseForRequest(
  key: string,
  incrementBy = 1,
  deviceFingerprint = ""
): Promise<{ license: License; usage: LicenseUsageRecord }> {
  const { license } = await assertLicenseEligible(key, incrementBy, deviceFingerprint);
  const usage = await incrementUsage(license.key, incrementBy);
  return { license, usage };
}
