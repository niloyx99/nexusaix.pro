import { getLicenseHeaders } from './nexusUser';
import { apiUrl, fetchWithRetry } from './api';

export interface ChartAnalyticsData {
  total: number;
  profit: number;
  loss: number;
  pending: number;
  skipped: number;
  accuracyPct: number;
  analyticsDay?: string;
  resetsAtLabel?: string;
  dailyHistory: Array<{
    date: string;
    label: string;
    total: number;
    profit: number;
    loss: number;
    accuracyPct: number;
    hour?: string;
  }>;
  recent: Array<{
    id: string;
    pair: string;
    direction: 'CALL' | 'PUT';
    status: 'pending' | 'profit' | 'loss' | 'skipped';
    signalAt: string;
    timeLabel?: string;
    verifiedAt?: string;
    confidencePct: number;
  }>;
}

export async function fetchChartAnalytics(): Promise<ChartAnalyticsData> {
  const res = await fetchWithRetry(apiUrl('/api/analytics/chart'), {
    headers: getLicenseHeaders(),
  });
  const payload = await res.json();
  if (!res.ok || !payload.success) {
    throw new Error(payload.error || 'Failed to load analytics');
  }
  return payload.data as ChartAnalyticsData;
}
