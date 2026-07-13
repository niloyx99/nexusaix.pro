import { apiUrl, fetchWithRetry } from './api';
import { getLicenseHeaders } from './nexusUser';

export interface NewsEvent {
  id: string;
  time: string;
  timeLabel: string;
  currency: string;
  event: string;
  impact: string;
  actual: string;
  forecast: string;
  previous: string;
  calendarDate: string;
  analysis?: NewsAnalysis | null;
}

export interface NewsAnalysis {
  status: 'ok' | 'fallback';
  eventId: string;
  summary: string;
  surprise: 'beat' | 'miss' | 'inline' | 'pending' | 'unknown';
  currencyBias: 'bullish' | 'bearish' | 'neutral';
  primaryPair: string;
  affectedPairs: string[];
  tradingBias: 'CALL' | 'PUT' | 'AVOID' | 'WAIT';
  confidencePct: number;
  directionReason: string;
  analysisText: string;
  keyTakeaways: string[];
}

export interface DailyNewsResponse {
  events: NewsEvent[];
  calendarDate: string;
  timezoneLabel: string;
  total: number;
  analyzed: number;
  autoAnalyzed: boolean;
  impactFilter: string;
  source: string;
}

export interface NewsAnalysisResponse {
  event: NewsEvent;
  analysis: NewsAnalysis;
}

async function parseJson<T>(res: Response): Promise<T> {
  const payload = await res.json();
  if (!res.ok || !payload.success) {
    throw new Error(payload.error || `Request failed (${res.status})`);
  }
  return payload.data as T;
}

export async function fetchDailyNews(): Promise<DailyNewsResponse> {
  const res = await fetchWithRetry(apiUrl('/api/news/daily'), {
    headers: getLicenseHeaders(),
  });
  return parseJson<DailyNewsResponse>(res);
}

export async function fetchNewsAnalysis(
  eventId: string,
  calendarDate?: string
): Promise<NewsAnalysisResponse> {
  const qs = calendarDate ? `?date=${encodeURIComponent(calendarDate)}` : '';
  const res = await fetch(apiUrl(`/api/news/analyze/${encodeURIComponent(eventId)}${qs}`), {
    headers: getLicenseHeaders(),
  });
  return parseJson<NewsAnalysisResponse>(res);
}
