import type { NexusUser } from '../types';
import { getCachedDeviceFingerprint, getDeviceFingerprint } from './deviceFingerprint';

const STORAGE_KEY = 'nexus_user';

export function loadNexusUser(): NexusUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NexusUser;
  } catch {
    return null;
  }
}

export function saveNexusUser(user: NexusUser): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function clearNexusUser(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getLicenseHeaders(): Record<string, string> {
  const user = loadNexusUser();
  const headers: Record<string, string> = {};
  if (user?.licenseKey) {
    headers['X-License-Key'] = user.licenseKey;
  }
  const fingerprint = user?.deviceFingerprint || getCachedDeviceFingerprint();
  if (fingerprint) {
    headers['X-Device-Fingerprint'] = fingerprint;
  }
  return headers;
}

export interface ValidatePayload {
  key: string;
  telegram: string;
  deviceFingerprint: string;
}

export async function validateLicenseApi(payload: ValidatePayload) {
  const res = await fetch('/api/licenses/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Fingerprint': payload.deviceFingerprint,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.valid) {
    throw new Error(data.message || 'License validation failed.');
  }
  return data as {
    valid: true;
    license: {
      key: string;
      tier: NexusUser['tier'];
      dailyLimit: number;
      holderName: string;
      holderEmail: string;
      holderTelegram: string;
    };
    usage?: { usedToday: number; remaining: number; totalScans: number };
    deviceBound?: boolean;
    deviceLimit?: number;
    devicesUsed?: number;
  };
}

export async function refreshLicenseStatus(licenseKey: string, deviceFingerprint?: string) {
  const fp = deviceFingerprint || (await getDeviceFingerprint());
  const res = await fetch(`/api/licenses/status?key=${encodeURIComponent(licenseKey)}`, {
    headers: {
      'X-License-Key': licenseKey,
      'X-Device-Fingerprint': fp,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'License status check failed.');
  }
  return res.json() as Promise<{
    tier: NexusUser['tier'];
    dailyLimit: number;
    deviceLimit: number;
    devicesUsed: number;
    holderName: string;
    createdAt: string;
    unlimitedDaily?: boolean;
    usage: { usedToday: number; remaining: number; totalScans: number };
    deviceBound?: boolean;
  }>;
}
