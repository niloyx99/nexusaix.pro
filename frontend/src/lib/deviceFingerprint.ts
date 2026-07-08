const FINGERPRINT_STORAGE_KEY = 'nexus_device_fp';

let memoryFingerprint = '';

function canvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-canvas';
    ctx.textBaseline = 'top';
    ctx.font = "16px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 280, 60);
    ctx.fillStyle = '#069';
    ctx.fillText('NEXUS-AI-DEVICE', 2, 2);
    ctx.strokeStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.arc(80, 20, 20, 0, Math.PI * 2);
    ctx.stroke();
    return canvas.toDataURL();
  } catch {
    return 'canvas-blocked';
  }
}

function collectSignals(): string {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { platform?: string };
  };

  return [
    nav.userAgent || '',
    nav.language || '',
    nav.languages?.join(',') || '',
    nav.platform || '',
    nav.hardwareConcurrency || 0,
    nav.deviceMemory || 0,
    screen.width,
    screen.height,
    screen.colorDepth,
    window.devicePixelRatio || 1,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    canvasFingerprint(),
    nav.userAgentData?.platform || '',
  ].join('|');
}

function fallbackHash(value: string): string {
  const parts: string[] = [];
  let acc = 2166136261;

  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < value.length; i += 1) {
      acc ^= value.charCodeAt(i) + round * 31;
      acc = Math.imul(acc, 16777619);
    }
    parts.push((acc >>> 0).toString(16).padStart(8, '0'));
  }

  return `nxf${parts.join('')}`;
}

async function hashString(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    try {
      const data = new TextEncoder().encode(value);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fall through to HTTP-safe hash on mobile browsers.
    }
  }

  return fallbackHash(value);
}

function readStoredFingerprint(): string {
  if (memoryFingerprint.length >= 16) return memoryFingerprint;

  try {
    const local = localStorage.getItem(FINGERPRINT_STORAGE_KEY);
    if (local && local.length >= 16) return local;
  } catch {
    // Private mode / storage blocked
  }

  try {
    const session = sessionStorage.getItem(FINGERPRINT_STORAGE_KEY);
    if (session && session.length >= 16) return session;
  } catch {
    // Ignore
  }

  return '';
}

function storeFingerprint(fingerprint: string): void {
  memoryFingerprint = fingerprint;
  try {
    localStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
  } catch {
    // Ignore
  }
  try {
    sessionStorage.setItem(FINGERPRINT_STORAGE_KEY, fingerprint);
  } catch {
    // Ignore
  }
}

export async function getDeviceFingerprint(): Promise<string> {
  const cached = readStoredFingerprint();
  if (cached.length >= 16) return cached;

  const fingerprint = await hashString(collectSignals());
  if (!fingerprint || fingerprint.length < 16) {
    throw new Error('Device fingerprint unavailable on this browser.');
  }

  storeFingerprint(fingerprint);
  return fingerprint;
}

export function getCachedDeviceFingerprint(): string {
  return readStoredFingerprint();
}
