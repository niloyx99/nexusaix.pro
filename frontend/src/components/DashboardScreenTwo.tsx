import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { CheckCircle, XCircle, Percent, BarChart3, TrendingUp, Clock, Loader2 } from 'lucide-react';
import NexusLogoAvatar from './NexusLogoAvatar';
import { fetchChartAnalytics, type ChartAnalyticsData } from '../lib/chartAnalytics';

const EMPTY_ANALYTICS: ChartAnalyticsData = {
  total: 0,
  profit: 0,
  loss: 0,
  pending: 0,
  skipped: 0,
  accuracyPct: 0,
  dailyHistory: [],
  recent: [],
};

export default function DashboardScreenTwo() {
  const [analytics, setAnalytics] = useState<ChartAnalyticsData>(EMPTY_ANALYTICS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAnalytics = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await fetchChartAnalytics();
      setAnalytics(data);
    } catch {
      if (!silent) setAnalytics(EMPTY_ANALYTICS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAnalytics();
    const interval = setInterval(() => void loadAnalytics(true), 15_000);
    return () => clearInterval(interval);
  }, [loadAnalytics]);

  const chartData =
    analytics.dailyHistory.length > 0
      ? analytics.dailyHistory.map((day) => ({
          percent: day.accuracyPct,
          label: day.label,
          day: day.hour?.replace(':00', 'h') ?? 'Today',
          color:
            day.accuracyPct >= 70
              ? 'green'
              : day.accuracyPct >= 50
                ? 'white'
                : 'rose',
        }))
      : [
          {
            percent: analytics.accuracyPct,
            label: analytics.total > 0 ? `${analytics.accuracyPct}%` : '—',
            day: 'Today',
            color: analytics.accuracyPct >= 70 ? 'green' : 'white',
          },
        ];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-6 pb-4 overscroll-contain scrollbar-none w-full lg:max-w-5xl lg:mx-auto lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start">
        <div className="lg:hidden flex items-center justify-between px-4 h-16 rounded-xl bg-black/10 backdrop-blur-2xl border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.02)] select-none lg:col-span-2 max-lg:mt-1">
          <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
            <div className="grid grid-cols-2 gap-1.5 w-4.5 h-4.5">
              <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
            </div>
          </div>
          <div className="flex-1 flex justify-center">
            <span className="text-[14px] font-black tracking-[0.25em] text-white select-none">
              NEXUS AI
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center p-1">
            <NexusLogoAvatar size="xs" />
          </div>
        </div>

        <div className="relative p-5 lg:p-6 rounded-xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.07] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_15px_30px_-5px_rgba(0,0,0,0.5)] lg:col-span-1">
          <div className="absolute top-4 left-5 flex items-center space-x-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="text-[11px] font-black uppercase text-white/50 tracking-wider">
              Chart Analysis Accuracy
            </span>
            {refreshing && <Loader2 className="w-3 h-3 text-white/40 animate-spin" />}
          </div>

          <div className="flex justify-between items-end h-40 px-1 pt-8 pb-1 relative">
            {chartData.map((bar, i) => (
              <div key={`${bar.day}-${i}`} className="flex flex-col items-center flex-1 space-y-2">
                <span className="text-[11px] font-bold text-white/60 tracking-tight select-none">
                  {bar.label}
                </span>
                <div className="relative w-6.5 h-24 flex items-end justify-center">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(bar.percent, 4)}%` }}
                    transition={{ delay: i * 0.08, duration: 0.85, ease: 'easeOut' }}
                    className={`w-full rounded-full ${
                      bar.color === 'green'
                        ? 'bg-[#82e5a3] shadow-[0_0_15px_rgba(130,229,163,0.4)]'
                        : 'bg-white/90'
                    }`}
                  />
                </div>
                <span className="text-[10px] font-bold text-white/40 tracking-tight uppercase select-none">
                  {bar.day}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-1 lg:col-span-2">
          <h2 className="text-[20px] font-extrabold tracking-tight text-white leading-none">
            Chart Upload Analytics
          </h2>
          <p className="text-[11px] text-white/40 mt-1">
            Today&apos;s chart uploads only · resets {analytics.resetsAtLabel ?? '02:00 AM (UTC+6)'}
            {analytics.analyticsDay ? ` · ${analytics.analyticsDay}` : ''}
            {analytics.pending > 0 ? ` · ${analytics.pending} verifying…` : ''}
            {analytics.skipped > 0 ? ` · ${analytics.skipped} skipped` : ''}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatCard
            icon={BarChart3}
            value={loading ? '…' : String(analytics.total)}
            label="Total Signals"
            delay={0.05}
          />
          <StatCard
            icon={CheckCircle}
            value={loading ? '…' : String(analytics.profit)}
            label="Profit Signals"
            valueClass="text-emerald-400"
            iconClass="bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
            delay={0.1}
          />
          <StatCard
            icon={XCircle}
            value={loading ? '…' : String(analytics.loss)}
            label="Loss Signals"
            valueClass="text-rose-400"
            iconClass="bg-rose-500/5 border-rose-500/20 text-rose-400"
            delay={0.15}
          />
          <StatCard
            icon={Percent}
            value={
              loading
                ? '…'
                : analytics.profit + analytics.loss > 0
                  ? `${analytics.accuracyPct}%`
                  : analytics.pending > 0
                    ? '…'
                    : analytics.total > 0
                      ? 'n/a'
                      : '0%'
            }
            label="Accuracy"
            valueClass="text-amber-400"
            iconClass="bg-amber-500/5 border-amber-500/20 text-amber-400"
            delay={0.2}
          />
        </div>

        {analytics.recent.length > 0 && (
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-[12px] font-extrabold text-white/40 uppercase tracking-widest pl-2">
              Today&apos;s Chart Signals
            </h3>
            <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] overflow-hidden divide-y divide-white/[0.04]">
              {analytics.recent.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-[11px]"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-white/85 truncate">{item.pair}</p>
                    <p className="text-white/35 mt-0.5">
                      {item.timeLabel ?? ''} · {item.direction} · {item.confidencePct}% conf
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border ${
                      item.status === 'profit'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : item.status === 'loss'
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                          : item.status === 'pending'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                            : 'bg-white/[0.04] border-white/[0.08] text-white/40'
                    }`}
                  >
                    {item.status === 'pending' ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" /> wait
                      </span>
                    ) : (
                      item.status
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  valueClass = 'text-white',
  iconClass = 'bg-white/[0.03] border-white/[0.08] text-white/60',
  delay,
}: {
  icon: typeof BarChart3;
  value: string;
  label: string;
  valueClass?: string;
  iconClass?: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="p-5 rounded-xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.07] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_15px_30px_-5px_rgba(0,0,0,0.45)] flex flex-col items-center text-center space-y-4"
    >
      <div
        className={`w-12 h-12 rounded-full border shadow-[0_0_15px_rgba(255,255,255,0.05)] flex items-center justify-center ${iconClass}`}
      >
        <Icon className="w-5 h-5 stroke-[1.5]" />
      </div>
      <div className="space-y-1">
        <div className={`text-[22px] font-black tracking-tight leading-none ${valueClass}`}>
          {value}
        </div>
        <div className="text-[10px] text-white/40 font-black uppercase tracking-wider">{label}</div>
      </div>
    </motion.div>
  );
}
