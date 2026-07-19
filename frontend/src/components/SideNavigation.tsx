import React from 'react';
import { Home, Zap, ClipboardCheck, BarChart2, User, LineChart, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { TabType } from '../types';
import NexusLogoAvatar from './NexusLogoAvatar';

interface SideNavigationProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

const NAV: { id: TabType; label: string; icon: typeof Home; group?: string }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'real', label: 'Real Market', icon: LineChart, group: 'analyzers' },
  { id: 'otc', label: 'OTC Market', icon: Sparkles, group: 'analyzers' },
  { id: 'signalGenerator', label: 'Signal Generator', icon: Zap, group: 'signals' },
  { id: 'signalChecker', label: 'Signal Checker', icon: ClipboardCheck, group: 'signals' },
  { id: 'stats', label: 'Analytics', icon: BarChart2 },
  { id: 'profile', label: 'Profile', icon: User },
];

const GROUP_LABELS: Record<string, string> = {
  analyzers: 'Analyzers',
  signals: 'Future Signal',
};

export default function SideNavigation({ activeTab, onChangeTab }: SideNavigationProps) {
  const shownGroups = new Set<string>();

  return (
    <aside className="hidden lg:flex flex-col w-[210px] xl:w-[228px] shrink-0 h-full border-r border-white/[0.06] bg-black/20 backdrop-blur-2xl">
      <div className="px-3 pt-5 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <NexusLogoAvatar size="sm" />
          <div className="min-w-0">
            <span className="text-[12px] font-black tracking-[0.12em] text-white block leading-tight">
              NEXUS AI
            </span>
            <span className="text-[9px] text-white/40 font-semibold tracking-wide">
              Analyzer
            </span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const showGroup =
            item.group && !shownGroups.has(item.group)
              ? (shownGroups.add(item.group), true)
              : false;

          return (
            <React.Fragment key={item.id}>
              {showGroup && item.group && (
                <p className="px-3 pt-3 pb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/30">
                  {GROUP_LABELS[item.group] ?? item.group}
                </p>
              )}
              <button
                type="button"
                onClick={() => onChangeTab(item.id)}
                className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-200 ${
                  isActive
                    ? 'text-white'
                    : 'text-white/45 hover:text-white/75 hover:bg-white/[0.04]'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="desktopNavIndicator"
                    className="absolute inset-0 rounded-lg bg-white/[0.06] border border-white/[0.1] shadow-[0_0_16px_rgba(255,255,255,0.04)]"
                    transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                  />
                )}
                <Icon
                  className={`w-4 h-4 relative z-10 shrink-0 ${isActive ? 'text-amber-400' : ''}`}
                />
                <span className="text-[12px] font-bold relative z-10 truncate">{item.label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </nav>

      <div className="px-2 pb-5 pt-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <NexusLogoAvatar size="xs" />
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-white block truncate">Hello Everyone</span>
            <span className="text-[9px] text-emerald-400/80 font-semibold">Active License</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
