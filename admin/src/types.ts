export type LicenseTier = "basic" | "pro" | "premium" | "regular";

export const UNLIMITED_DAILY_LIMIT = -1;
export const UNLIMITED_DEVICE_LIMIT = -1;

export interface TierConfig {
  id: LicenseTier;
  label: string;
  dailySignals: number;
  color: string;
  description: string;
}

export interface DeviceBinding {
  fingerprint: string;
  ip: string;
  userAgent: string;
  boundAt: string;
}

export interface License {
  id: string;
  key: string;
  tier: LicenseTier;
  dailyLimit: number;
  deviceLimit: number;
  holderName: string;
  holderEmail: string;
  holderTelegram: string;
  status: "active" | "blocked";
  createdAt: string;
  note: string;
  deviceBinding?: DeviceBinding | null;
  deviceBindings?: DeviceBinding[];
}

export type AdminView = "dashboard" | "licenses" | "create";

export type SignalLimitMode = "tier" | "custom" | "unlimited";

export const DEVICE_LIMIT_OPTIONS = [
  { value: 1, label: "1 Device" },
  { value: 2, label: "2 Devices" },
  { value: 3, label: "3 Devices" },
  { value: 4, label: "4 Devices" },
  { value: 5, label: "5 Devices" },
  { value: 6, label: "6 Devices" },
  { value: 10, label: "10 Devices" },
  { value: UNLIMITED_DEVICE_LIMIT, label: "Unlimited" },
] as const;
