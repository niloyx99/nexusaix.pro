import React from 'react';
import { Home, Compass, BarChart2, User } from 'lucide-react';
import { TabType } from '../types';
import { motion } from 'motion/react';

interface BottomNavigationProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

export default function BottomNavigation({ activeTab, onChangeTab }: BottomNavigationProps) {
  const navItems = [
    { id: 'home' as TabType, icon: Home, label: 'Home' },
    { id: 'signals' as TabType, icon: Compass, label: 'Signals' },
    { id: 'stats' as TabType, icon: BarChart2, label: 'Stats' },
    { id: 'profile' as TabType, icon: User, label: 'Profile' },
  ];

  return (
    <div
      className="flex-shrink-0 z-40 select-none px-5 pt-2"
      style={{ paddingBottom: 'var(--app-safe-bottom)' }}
    >
      <div className="h-16 rounded-3xl bg-black/10 backdrop-blur-2xl border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.02)] flex items-center justify-around px-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onChangeTab(item.id)}
              className="relative flex flex-col items-center justify-center w-12 h-12 rounded-2xl focus:outline-none transition-all duration-300"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              aria-label={item.label}
            >
              {isActive && (
                <motion.div
                  layoutId="activeNavIndicator"
                  className="absolute inset-1 rounded-2xl bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)]"
                  transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                />
              )}

              <Icon
                className={`w-5.5 h-5.5 relative z-10 transition-all duration-300 ${
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
