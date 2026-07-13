import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Loader2,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  BrainCircuit,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  CalendarClock,
} from 'lucide-react';
import { fetchDailyNews, type NewsAnalysis, type NewsEvent } from '../lib/newsApi';

function impactStyle(impact: string) {
  const i = impact.toLowerCase();
  if (i === 'high') return { bg: 'bg-rose-500/15 border-rose-500/30', text: 'text-rose-300', label: 'HIGH' };
  if (i === 'medium') return { bg: 'bg-amber-500/15 border-amber-500/30', text: 'text-amber-300', label: 'MED' };
  if (i === 'low') return { bg: 'bg-emerald-500/10 border-emerald-500/25', text: 'text-emerald-300', label: 'LOW' };
  return { bg: 'bg-white/[0.04] border-white/[0.08]', text: 'text-white/40', label: 'N/A' };
}

function biasIcon(bias: NewsAnalysis['currencyBias']) {
  if (bias === 'bullish') return <TrendingUp className="w-4 h-4 text-emerald-400" />;
  if (bias === 'bearish') return <TrendingDown className="w-4 h-4 text-rose-400" />;
  return <Minus className="w-4 h-4 text-white/50" />;
}

function signalLabel(bias: NewsAnalysis['tradingBias']): { label: string; sub: string; style: string; glow: string; icon: React.ReactNode } {
  if (bias === 'CALL') {
    return {
      label: 'BUY',
      sub: 'CALL',
      style: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200',
      glow: 'shadow-[0_0_32px_rgba(16,185,129,0.12)]',
      icon: <ArrowUpRight className="w-7 h-7" />,
    };
  }
  if (bias === 'PUT') {
    return {
      label: 'SELL',
      sub: 'PUT',
      style: 'bg-rose-500/20 border-rose-400/50 text-rose-200',
      glow: 'shadow-[0_0_32px_rgba(244,63,94,0.12)]',
      icon: <ArrowDownRight className="w-7 h-7" />,
    };
  }
  if (bias === 'WAIT') {
    return {
      label: 'WAIT',
      sub: 'HOLD',
      style: 'bg-amber-500/15 border-amber-500/35 text-amber-300',
      glow: '',
      icon: <Clock className="w-6 h-6" />,
    };
  }
  return {
    label: 'AVOID',
    sub: 'SKIP',
    style: 'bg-white/[0.04] border-white/[0.10] text-white/45',
    glow: '',
    icon: <Minus className="w-6 h-6" />,
  };
}

function formatAnalysisLines(text: string, maxLines = 10): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^###\s+/, '').replace(/^-\s+\*\*([^*]+)\*\*:\s*/, '$1: ').replace(/\*\*/g, ''))
    .filter((l) => l.trim() && !l.startsWith('#'))
    .slice(0, maxLines);
}

function NewsCard({ item, idx }: { item: NewsEvent; idx: number }) {
  const impact = impactStyle(item.impact);
  const released = item.actual !== 'n/a';
  const analysis = item.analysis;
  const signal = analysis ? signalLabel(analysis.tradingBias) : null;
  const market = analysis?.primaryPair || analysis?.affectedPairs?.[0] || `${item.currency} pairs`;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.04 }}
      className="w-full rounded-xl bg-white/[0.03] border border-white/[0.08] overflow-hidden"
    >
      <div className="flex flex-col lg:flex-row lg:min-h-[280px]">
        {/* Left — Market + Signal */}
        <div className="lg:w-[280px] xl:w-[320px] shrink-0 p-4 lg:p-5 border-b lg:border-b-0 lg:border-r border-white/[0.06] bg-black/20">
          <div className="rounded-lg bg-white/[0.04] backdrop-blur-sm border border-white/[0.08] p-3 mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/30 border border-white/[0.08] text-[12px] font-bold text-white/85">
                <Clock className="w-3.5 h-3.5 shrink-0 text-amber-400/80" />
                {item.timeLabel}
              </span>
              <span className="px-2.5 py-1 rounded-md bg-blue-500/15 border border-blue-500/30 text-[12px] font-black text-blue-300">
                {item.currency}
              </span>
              <span className={`px-2.5 py-1 rounded-md border text-[11px] font-black ${impact.bg} ${impact.text}`}>
                {impact.label}
              </span>
              {!released && (
                <span className="px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/25 text-[11px] font-black text-amber-300">
                  UPCOMING
                </span>
              )}
            </div>
          </div>

          <h3 className="text-[16px] lg:text-[17px] font-bold text-white leading-snug mb-4 px-0.5">{item.event}</h3>

          {analysis && signal ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-3">
                <p className="text-[10px] font-black text-white/35 uppercase tracking-[0.2em] mb-1.5">Market</p>
                <p className="text-[28px] xl:text-[32px] font-black text-white tracking-tight leading-none">{market}</p>
              </div>

              <div className={`inline-flex flex-col items-center justify-center w-full py-5 rounded-lg border-2 ${signal.style} ${signal.glow}`}>
                <div className="flex items-center gap-2 mb-1">
                  {signal.icon}
                  <span className="text-[32px] xl:text-[36px] font-black leading-none">{signal.label}</span>
                </div>
                <span className="text-[11px] font-bold opacity-70 uppercase tracking-widest">{signal.sub}</span>
                <span className="mt-2 text-[13px] font-bold opacity-80">{analysis.confidencePct}% confidence</span>
              </div>

              {analysis.directionReason && (
                <p className="text-[13px] text-white/65 leading-relaxed px-0.5">{analysis.directionReason}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-white/35 gap-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
              <Loader2 className="w-7 h-7 animate-spin" />
              <p className="text-[13px] font-semibold">Analyzing...</p>
            </div>
          )}
        </div>

        {/* Center — Data */}
        <div className="lg:w-[200px] xl:w-[220px] shrink-0 p-3 lg:p-4 border-b lg:border-b-0 lg:border-r border-white/[0.06]">
          <div className="grid grid-cols-3 lg:grid-cols-1 gap-2 h-full">
            <div className="rounded-lg bg-white/[0.04] border border-white/[0.07] px-3 py-3 lg:py-4">
              <p className="text-[10px] font-black text-white/35 uppercase tracking-wider">Actual</p>
              <p className="text-[15px] lg:text-[16px] font-bold text-white/85 mt-1">{item.actual}</p>
            </div>
            <div className="rounded-lg bg-amber-500/[0.06] border border-amber-500/20 px-3 py-3 lg:py-4">
              <p className="text-[10px] font-black text-amber-400/60 uppercase tracking-wider">Forecast</p>
              <p className="text-[15px] lg:text-[16px] font-bold text-amber-300 mt-1">{item.forecast}</p>
            </div>
            <div className="rounded-lg bg-white/[0.04] border border-white/[0.07] px-3 py-3 lg:py-4">
              <p className="text-[10px] font-black text-white/35 uppercase tracking-wider">Previous</p>
              <p className="text-[15px] lg:text-[16px] font-bold text-white/60 mt-1">{item.previous}</p>
            </div>
          </div>
        </div>

        {/* Right — AI Analysis */}
        <div className="flex-1 min-w-0 p-4 lg:p-5 flex flex-col">
          {analysis ? (
            <>
              <div className="flex items-center gap-2 mb-3 rounded-lg bg-amber-500/[0.06] border border-amber-500/15 px-3 py-2 w-fit">
                <BrainCircuit className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-[11px] font-black text-amber-400/90 uppercase tracking-widest">Gemini AI Analysis</span>
              </div>

              <p className="text-[15px] lg:text-[16px] font-semibold text-white/90 leading-relaxed mb-4">
                {analysis.summary}
              </p>

              <div className="flex flex-wrap gap-2 mb-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] text-[12px] font-bold text-white/65 capitalize">
                  {biasIcon(analysis.currencyBias)}
                  {analysis.currencyBias}
                </span>
                <span className="px-3 py-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] text-[12px] font-bold text-white/65 uppercase">
                  {analysis.surprise}
                </span>
                {analysis.affectedPairs.map((p) => (
                  <span
                    key={p}
                    className={`px-3 py-1.5 rounded-md border text-[12px] font-bold ${
                      p === market
                        ? 'bg-blue-500/15 border-blue-500/35 text-blue-200'
                        : 'bg-white/[0.03] border-white/[0.08] text-white/50'
                    }`}
                  >
                    {p}
                  </span>
                ))}
              </div>

              <div className="flex-1 space-y-2 rounded-lg bg-white/[0.02] border border-white/[0.05] p-3">
                {formatAnalysisLines(analysis.analysisText, 10).map((line, i) => (
                  <p key={i} className="text-[13px] lg:text-[14px] text-white/55 leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>

              {analysis.keyTakeaways.length > 0 && (
                <div className="mt-4 pt-3 border-t border-white/[0.06] space-y-2">
                  {analysis.keyTakeaways.slice(0, 3).map((t, i) => (
                    <p key={i} className="text-[13px] text-amber-300/80 leading-relaxed">
                      • {t}
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-white/30 rounded-lg bg-white/[0.02] border border-white/[0.05]">
              <p className="text-[14px]">Waiting for AI analysis...</p>
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export default function NewsSignalsScreen() {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [calendarDate, setCalendarDate] = useState('');
  const [timezoneLabel, setTimezoneLabel] = useState('UTC+6');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNews = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await fetchDailyNews();
      setEvents(data.events);
      setCalendarDate(data.calendarDate);
      setTimezoneLabel(data.timezoneLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load news');
      if (!silent) setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNews();
    const interval = window.setInterval(() => void loadNews(true), 120_000);
    return () => window.clearInterval(interval);
  }, [loadNews]);

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-4 overscroll-contain scrollbar-none w-full">
        <div className="lg:hidden flex items-center justify-center px-4 h-14 rounded-xl bg-black/10 backdrop-blur-2xl border border-white/[0.06] mb-4 max-lg:mt-1 relative">
          <div className="absolute left-4 w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <CalendarClock className="w-5 h-5 text-amber-400" />
          </div>
          <span className="text-[14px] font-black tracking-[0.2em] text-white">NEWS SIGNALS</span>
        </div>

        {(calendarDate || events.length > 0) && (
          <div className="hidden lg:block mb-4">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-white/[0.04] border border-white/[0.07] px-3 py-2">
              <span className="text-[12px] text-white/50">{timezoneLabel}</span>
              {calendarDate && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-[12px] text-white/50">{calendarDate}</span>
                </>
              )}
              {events.length > 0 && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-[12px] font-semibold text-amber-400/80">
                    {events.length} signal{events.length > 1 ? 's' : ''}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-white/40">
            <Loader2 className="w-8 h-8 animate-spin mb-3" />
            <p className="text-[13px] font-semibold">Loading high impact news...</p>
          </div>
        ) : error ? (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 p-5 text-center max-w-lg mx-auto">
            <AlertTriangle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
            <p className="text-[13px] text-rose-200/90 font-semibold">{error}</p>
            <button type="button" onClick={() => void loadNews()} className="mt-3 text-[12px] font-bold text-amber-300 underline">
              Try again
            </button>
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-8 text-center text-white/40 text-[13px] max-w-lg mx-auto">
            আজ কোনো HIGH impact নিউজ নেই। নতুন high impact নিউজ এলে এখানে দেখাবে।
          </div>
        ) : (
          <div className="flex flex-col gap-4 w-full">
            {events.map((item, idx) => (
              <NewsCard key={item.id} item={item} idx={idx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
