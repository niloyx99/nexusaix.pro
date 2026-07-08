import { motion } from "motion/react";
import { Users, Key, Crown, Zap, TrendingUp } from "lucide-react";
import type { License } from "../types";
import { TIER_CONFIG, formatTierDailySignals } from "../lib/tiers";

interface DashboardProps {
  licenses: License[];
}

export default function Dashboard({ licenses }: DashboardProps) {
  const active = licenses.filter((l) => l.status === "active");
  const byTier = {
    basic: active.filter((l) => l.tier === "basic").length,
    pro: active.filter((l) => l.tier === "pro").length,
    premium: active.filter((l) => l.tier === "premium").length,
    regular: active.filter((l) => l.tier === "regular").length,
  };

  const cards = [
    {
      label: "Total Licenses",
      value: licenses.length,
      sub: `${active.length} active`,
      icon: Key,
      accent: "text-amber-400",
    },
    {
      label: "Active Users",
      value: active.length,
      sub: "Can login with key",
      icon: Users,
      accent: "text-emerald-400",
    },
    {
      label: "Regular Unlimited",
      value: byTier.regular,
      sub: "Unlimited signals / day",
      icon: Crown,
      accent: "text-violet-300",
    },
    {
      label: "Blocked Users",
      value: licenses.filter((l) => l.status === "blocked").length,
      sub: "Cannot login",
      icon: TrendingUp,
      accent: "text-rose-400",
    },
  ];

  return (
    <div className="space-y-6 w-full max-w-none">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-black text-white tracking-tight">Dashboard</h1>
        <p className="text-[13px] text-white/45 mt-1">License overview & daily signal limits</p>
      </motion.div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-4 sm:p-5 rounded-2xl bg-white/[0.03] border border-white/[0.07] backdrop-blur-xl"
            >
              <Icon className={`w-5 h-5 ${card.accent} mb-3`} />
              <p className="text-[22px] sm:text-2xl font-black text-white">{card.value}</p>
              <p className="text-[11px] font-bold text-white/70 mt-1">{card.label}</p>
              <p className="text-[9px] text-white/35 mt-0.5">{card.sub}</p>
            </motion.div>
          );
        })}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="p-5 sm:p-6 rounded-[28px] bg-white/[0.03] border border-white/[0.07] space-y-4"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-400" />
          <h2 className="text-[14px] font-extrabold text-white uppercase tracking-wide">
            Signal Plans (Chart + Future)
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(Object.keys(TIER_CONFIG) as Array<keyof typeof TIER_CONFIG>).map((tier) => {
            const cfg = TIER_CONFIG[tier];
            return (
              <div
                key={tier}
                className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-black text-white">{cfg.label}</span>
                  <span className="text-[10px] font-mono text-white/40">{byTier[tier]} users</span>
                </div>
                <p className={`text-2xl font-black ${tier === "regular" ? "text-violet-400" : "text-amber-400"}`}>
                  {formatTierDailySignals(cfg.dailySignals)}
                </p>
                <p className="text-[10px] text-white/40">signals per day</p>
                <p className="text-[10px] text-white/50 leading-relaxed">{cfg.description}</p>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
