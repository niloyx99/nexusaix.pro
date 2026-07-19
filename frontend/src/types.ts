export type TabType =
  | 'home'
  | 'real'
  | 'otc'
  | 'signalGenerator'
  | 'signalChecker'
  | 'stats'
  | 'profile';

export type LicenseTier = 'basic' | 'pro' | 'premium' | 'regular';

export interface NexusUser {
  telegram: string;
  licenseKey: string;
  tier: LicenseTier;
  dailyLimit: number;
  deviceLimit?: number;
  holderName: string;
  deviceFingerprint?: string;
  usedToday?: number;
  remaining?: number;
  totalScans?: number;
  devicesUsed?: number;
  validatedAt: string;
  licenseCreatedAt?: string;
}

export interface KPICardData {
  title: string;
  subtitle: string;
  value: string;
  percentage: number;
  trend: 'up' | 'down';
  color: 'yellow' | 'green' | 'blue';
}

export interface StatCardData {
  id: string;
  title: string;
  value: string;
  icon: string;
}
