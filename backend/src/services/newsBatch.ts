import type { ForexNewsEvent } from "./forexNewsClient.js";
import {
  analyzeNewsEvent,
  canRunNewsScheduler,
  getCachedAnalysis,
  hydrateNewsAnalysisCache,
  markNewsSchedulerRun,
  shouldRefreshAnalysis,
  type NewsAnalysisResult,
} from "./newsAnalysis.js";

export interface NewsEventWithAnalysis extends ForexNewsEvent {
  analysis: NewsAnalysisResult | null;
}

const inFlightBatch = { running: false };

async function mapSequential<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const item of items) {
    results.push(await worker(item));
  }
  return results;
}

/** User-facing: return cached analysis only — never calls Gemini. */
export function attachCachedAnalyses(events: ForexNewsEvent[]): NewsEventWithAnalysis[] {
  return events.map((event) => ({
    ...event,
    analysis: getCachedAnalysis(event)?.data ?? null,
  }));
}

/** Background scheduler: initial daily pass + 30-min confirmation + actual release only. */
export async function runScheduledNewsAnalysis(): Promise<number> {
  if (inFlightBatch.running) return 0;
  if (!canRunNewsScheduler()) return 0;

  const { fetchDailyForexNews } = await import("./forexNewsClient.js");
  const data = await fetchDailyForexNews();

  await hydrateNewsAnalysisCache(data.calendarDate);

  const due = data.events.filter((e) => shouldRefreshAnalysis(e, getCachedAnalysis(e)));
  if (!due.length) return 0;

  inFlightBatch.running = true;
  try {
    await mapSequential(due, (event) => analyzeNewsEvent(event, { force: false }));
    return due.length;
  } finally {
    inFlightBatch.running = false;
  }
}

export async function bootstrapNewsAnalysis(): Promise<void> {
  const { fetchDailyForexNews } = await import("./forexNewsClient.js");
  const data = await fetchDailyForexNews();
  const loaded = await hydrateNewsAnalysisCache(data.calendarDate);
  console.log(`News analysis cache: ${loaded} loaded from database for ${data.calendarDate}`);

  const due = data.events.filter((e) => shouldRefreshAnalysis(e, getCachedAnalysis(e)));
  if (!due.length) {
    console.log("News analysis: all events cached — no Gemini calls needed");
    return;
  }

  if (inFlightBatch.running) return;
  inFlightBatch.running = true;
  try {
    console.log(`News analysis: analyzing ${due.length} event(s) in background`);
    await mapSequential(due, (event) => analyzeNewsEvent(event, { force: false }));
  } finally {
    inFlightBatch.running = false;
    markNewsSchedulerRun();
  }
}

export function startNewsAnalysisScheduler(intervalMs = 5 * 60_000): () => void {
  const tick = () => {
    void runScheduledNewsAnalysis().catch(() => {
      // background refresh — ignore transient errors
    });
  };
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
