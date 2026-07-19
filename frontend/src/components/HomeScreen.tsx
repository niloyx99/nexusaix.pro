import React from 'react';
import { motion } from 'motion/react';
import type { NexusUser } from '../types';
import NexusLogoAvatar from './NexusLogoAvatar';

interface HomeScreenProps {
  user: NexusUser;
}

const QUOTES = [
  {
    line: 'Discipline beats emotion.',
    sub: 'Trade the plan — not the fear, not the greed.',
  },
  {
    line: 'Patience is a position.',
    sub: 'Waiting for the right candle is also a winning trade.',
  },
  {
    line: 'One clean setup > ten rushed entries.',
    sub: 'Quality signals protect your capital more than volume.',
  },
  {
    line: 'Stay calm. Stay focused. Stay consistent.',
    sub: 'NEXUS AI is your edge — you are the decision maker.',
  },
];

export default function HomeScreen({ user }: HomeScreenProps) {
  const remaining =
    typeof user.remaining === 'number' ? user.remaining : user.dailyLimit;

  return (
    <div className="w-full h-full min-h-0 overflow-y-auto custom-scrollbar pb-4 lg:pb-8">
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-5 lg:gap-8 lg:justify-center lg:min-h-full lg:py-6">
        <div className="space-y-1 lg:hidden px-0.5">
          <h1 className="text-[28px] font-extrabold tracking-tight text-white leading-tight">
            Hello {user.holderName || 'Everyone'}
          </h1>
          <p className="text-[13px] text-white/50 font-medium">Welcome Back!</p>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.06] to-white/[0.01] px-5 py-6 sm:px-8 sm:py-8"
        >
          <div className="absolute -top-16 -right-10 w-48 h-48 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
          <div className="relative flex items-start gap-4">
            <NexusLogoAvatar size="lg" rounded="xl" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                Home
              </p>
              <h2 className="text-xl sm:text-2xl font-extrabold text-white mt-1 tracking-tight">
                Hello {user.holderName || 'Everyone'}
              </h2>
              <p className="text-[13px] text-white/50 mt-1.5 leading-relaxed">
                Welcome back. Tap the menu (top left) to open Home, Analyzers, Signal tools, Analytics & Profile.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-400/20">
                  {user.tier} license
                </span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-white/[0.06] text-white/60 border border-white/[0.08]">
                  {remaining === -1 || remaining > 9000
                    ? 'Unlimited'
                    : `${remaining} scans left`}
                </span>
              </div>
            </div>
          </div>
        </motion.section>

        <section className="space-y-3">
          <p className="px-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/35">
            Daily focus
          </p>
          <div className="space-y-3">
            {QUOTES.map((q, i) => (
              <motion.blockquote
                key={q.line}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i + 0.08 }}
                className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 py-4 sm:px-6 sm:py-5"
              >
                <p className="text-[15px] sm:text-[17px] font-extrabold text-white tracking-tight leading-snug">
                  “{q.line}”
                </p>
                <p className="mt-2 text-[12px] sm:text-[13px] text-white/45 leading-relaxed">
                  {q.sub}
                </p>
              </motion.blockquote>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
