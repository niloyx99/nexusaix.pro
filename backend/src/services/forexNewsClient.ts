const NEWS_API_BASE = (
  process.env.FOREX_NEWS_API_URL || "https://forexfactoryscrapper-main.onrender.com"
).replace(/\/$/, "");

const UTC_OFFSET_HOURS = 6;
/** ForexFactory calendar times from the scraper are US Eastern (site default). */
const FOREX_FACTORY_TIMEZONE = "America/New_York";

export interface ForexNewsEvent {
  id: string;
  time: string;
  timeLabel: string;
  timeUtcMs: number;
  currency: string;
  event: string;
  impact: string;
  actual: string;
  forecast: string;
  previous: string;
  calendarDate: string;
}

interface RawForexRow {
  ID?: string;
  Time?: string;
  Currency?: string;
  Event?: string;
  Impact?: string;
  Actual?: string;
  Forecast?: string;
  Previous?: string;
}

function utc6DateParts(date = new Date()): { day: number; month: number; year: number; dateKey: string } {
  const utc6 = new Date(date.getTime() + UTC_OFFSET_HOURS * 3600 * 1000);
  const day = utc6.getUTCDate();
  const month = utc6.getUTCMonth() + 1;
  const year = utc6.getUTCFullYear();
  return {
    day,
    month,
    year,
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function localTimeInZoneToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  let utcGuess = Date.UTC(year, month - 1, day, hour + 5, minute);

  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = formatter.formatToParts(new Date(utcGuess));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

    const y = Number(get("year"));
    const m = Number(get("month"));
    const d = Number(get("day"));
    let h = Number(get("hour"));
    const min = Number(get("minute"));
    if (h === 24) h = 0;

    if (y === year && m === month && d === day && h === hour && min === minute) {
      return utcGuess;
    }

    const minuteDiff = (hour - h) * 60 + (minute - min) + (day - d) * 24 * 60;
    utcGuess += minuteDiff * 60 * 1000;
  }

  return utcGuess;
}

export function parseForexNewsTimeUtcMs(raw: string): number | null {
  const match = raw.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return null;

  return localTimeInZoneToUtc(
    Number(match[3]),
    Number(match[2]),
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    FOREX_FACTORY_TIMEZONE
  );
}

function formatUtc6TimeLabel(utcMs: number): string {
  const utc6 = new Date(utcMs + UTC_OFFSET_HOURS * 3600 * 1000);
  const h24 = utc6.getUTCHours();
  const min = utc6.getUTCMinutes();

  if (h24 === 0 && min === 0) return "All Day";

  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

function parseTimeFields(raw: string): { timeLabel: string; timeUtcMs: number } {
  const utcMs = parseForexNewsTimeUtcMs(raw);
  if (utcMs === null) {
    const fallback = raw.match(/(\d{2}:\d{2})/)?.[1] ?? raw;
    return { timeLabel: fallback, timeUtcMs: 0 };
  }
  return { timeLabel: formatUtc6TimeLabel(utcMs), timeUtcMs: utcMs };
}

function normalizeRow(row: RawForexRow, calendarDate: string): ForexNewsEvent | null {
  const id = String(row.ID ?? "").trim();
  if (!id) return null;

  const time = String(row.Time ?? "").trim();
  const { timeLabel, timeUtcMs } = parseTimeFields(time);

  return {
    id,
    time,
    timeLabel,
    timeUtcMs,
    currency: String(row.Currency ?? "").trim().toUpperCase(),
    event: String(row.Event ?? "").trim(),
    impact: String(row.Impact ?? "n/a").trim().toLowerCase(),
    actual: String(row.Actual ?? "n/a").trim(),
    forecast: String(row.Forecast ?? "n/a").trim(),
    previous: String(row.Previous ?? "n/a").trim(),
    calendarDate,
  };
}

export async function fetchDailyForexNews(
  date = new Date()
): Promise<{ events: ForexNewsEvent[]; calendarDate: string; timezoneLabel: string }> {
  const { day, month, year, dateKey } = utc6DateParts(date);
  const url = `${NEWS_API_BASE}/api/forex/daily?day=${day}&month=${month}&year=${year}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) {
    throw new Error(`Forex news API returned ${response.status}`);
  }

  const payload = (await response.json()) as { results?: RawForexRow[] };
  const events = (payload.results ?? [])
    .map((row) => normalizeRow(row, dateKey))
    .filter((row): row is ForexNewsEvent => row !== null)
    .filter((row) => row.impact === "high")
    .sort((a, b) => a.timeUtcMs - b.timeUtcMs);

  return {
    events,
    calendarDate: dateKey,
    timezoneLabel: "UTC+6",
  };
}

export async function findForexNewsEvent(
  eventId: string,
  calendarDate?: string
): Promise<ForexNewsEvent | null> {
  const { events, calendarDate: today } = await fetchDailyForexNews();
  const targetDate = calendarDate ?? today;
  const match = events.find((e) => e.id === eventId && e.calendarDate === targetDate);
  if (match) return match;

  if (calendarDate && calendarDate !== today) {
    const [y, m, d] = calendarDate.split("-").map(Number);
    const { events: datedEvents } = await fetchDailyForexNews(new Date(Date.UTC(y, m - 1, d)));
    return datedEvents.find((e) => e.id === eventId) ?? null;
  }

  return null;
}
