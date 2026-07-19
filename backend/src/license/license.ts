export type LicenseTier = "basic" | "pro" | "premium" | "regular";
export type LicenseStatus = "active" | "blocked";

/** dailyLimit / deviceLimit: -1 = unlimited */
export const UNLIMITED_DAILY_LIMIT = -1;
export const UNLIMITED_DEVICE_LIMIT = -1;

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
  status: LicenseStatus;
  createdAt: string;
  note: string;
  /** @deprecated use deviceBindings */
  deviceBinding?: DeviceBinding | null;
  deviceBindings?: DeviceBinding[];
}

export interface LicenseUsageRecord {
  date: string;
  count: number;
  totalScans: number;
}

export interface ValidateLicenseBody {
  key: string;
  telegram: string;
  email?: string;
  deviceFingerprint?: string;
  ip?: string;
  userAgent?: string;
}

export interface ValidateLicenseResponse {
  valid: boolean;
  message?: string;
  license?: {
    key: string;
    tier: LicenseTier;
    dailyLimit: number;
    holderName: string;
    holderEmail: string;
    holderTelegram: string;
    status: LicenseStatus;
  };
  usage?: {
    usedToday: number;
    remaining: number;
    totalScans: number;
  };
  deviceBound?: boolean;
  deviceLimit?: number;
  devicesUsed?: number;
}

export const TIER_DAILY_LIMITS: Record<LicenseTier, number> = {
  basic: 12,
  pro: 20,
  premium: 50,
  regular: UNLIMITED_DAILY_LIMIT,
};
