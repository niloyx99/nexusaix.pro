import type { LicenseTier, TierConfig } from "../types";
import { UNLIMITED_DAILY_LIMIT } from "../types";

export const TIER_CONFIG: Record<LicenseTier, TierConfig> = {
  basic: {
    id: "basic",
    label: "Basic",
    dailySignals: 12,
    color: "emerald",
    description: "12 chart + future signals per day",
  },
  pro: {
    id: "pro",
    label: "Pro",
    dailySignals: 20,
    color: "blue",
    description: "20 chart + future signals per day",
  },
  premium: {
    id: "premium",
    label: "Premium",
    dailySignals: 50,
    color: "amber",
    description: "50 chart + future signals per day",
  },
  regular: {
    id: "regular",
    label: "Regular",
    dailySignals: UNLIMITED_DAILY_LIMIT,
    color: "violet",
    description: "Unlimited chart + future signals per day",
  },
};

export function formatTierDailySignals(limit: number): string {
  return limit < 0 ? "Unlimited" : `${limit}/day`;
}

export function getDailyLimit(tier: LicenseTier): number {
  return TIER_CONFIG[tier].dailySignals;
}
