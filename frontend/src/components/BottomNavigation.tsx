import React from 'react';
import { Home, Zap, ClipboardCheck, BarChart2, User, LineChart, Sparkles } from 'lucide-react';
import { TabType } from '../types';
import { motion } from 'motion/react';

interface BottomNavigationProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

export default function BottomNavigation({ activeTab, onChangeTab }: BottomNavigationProps) {
  const navItems = [
    { id: 'home' as TabType, icon: Home, label: 'Home' },
    { id: 'real' as TabType, icon: LineChart, label: 'Real' },
    { id: 'otc' as TabType, icon: Sparkles, label: 'OTC' },
    { id: 'signalGenerator' as TabType, icon: Zap, label: 'Generator' },
    { id: 'signalChecker' as TabType, icon: ClipboardCheck, label: 'Checker' },
    { id: 'stats' as TabType, icon: BarChart2, label: 'Analytics' },
    { id: 'profile' as TabType, icon: User, label: 'Profile' },
  ];

  return (
    <div
      className="flex-shrink-0 z-40 select-none px-3 pt-2"
      style={{ paddingBottom: 'var(--app-safe-bottom)' }}
    >
      <div className="h-16 rounded-xl bg-black/10 backdrop-blur-2xl border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.02)] flex items-center justify-around px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onChangeTab(item.id)}
              className="relative flex flex-col items-center justify-center w-10 h-12 rounded-lg focus:outline-none transition-all duration-300"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              aria-label={item.label}
            >
              {isActive && (
                <motion.div
                  layoutId="activeNavIndicator"
                  className="absolute inset-0.5 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)]"
                  transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                />
              )}

              <Icon
                className={`w-5 h-5 relative z-10 transition-all duration-300 ${
                  isActive
                    ? 'text-white scale-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                    : 'text-white/40 hover:text-white/60 hover:scale-105'
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
