import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Home, Zap, ClipboardCheck, BarChart2, User, LineChart, Sparkles, X } from 'lucide-react';
import { TabType } from '../types';
import NexusLogoAvatar from './NexusLogoAvatar';

interface MobileDrawerProps {
  open: boolean;
  activeTab: TabType;
  onClose: () => void;
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

export default function MobileDrawer({
  open,
  activeTab,
  onClose,
  onChangeTab,
}: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const shownGroups = new Set<string>();

  return (
    <AnimatePresence>
      {open && (
        <div className="lg:hidden fixed inset-0 z-[80]" role="dialog" aria-modal="true">
          <motion.button
            type="button"
            aria-label="Close menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
          />

          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="absolute left-0 top-0 bottom-0 w-[50%] max-w-[280px] min-w-[200px] flex flex-col border-r border-white/[0.08] bg-[#0d0f12]/95 backdrop-blur-2xl shadow-[8px_0_40px_rgba(0,0,0,0.55)]"
            style={{ paddingTop: 'var(--app-safe-top, 0px)' }}
          >
            <div className="px-3 pt-4 pb-3 border-b border-white/[0.06] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <NexusLogoAvatar size="sm" />
                <div className="min-w-0">
                  <span className="text-[12px] font-black tracking-[0.12em] text-white block leading-tight">
                    NEXUS AI
                  </span>
                  <span className="text-[9px] text-white/40 font-semibold tracking-wide">
                    Menu
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/50 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
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
                      onClick={() => {
                        onChangeTab(item.id);
                        onClose();
                      }}
                      className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-200 ${
                        isActive
                          ? 'text-white bg-white/[0.06] border border-white/[0.1]'
                          : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04] border border-transparent'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${isActive ? 'text-amber-400' : ''}`}
                      />
                      <span className="text-[12px] font-bold truncate">{item.label}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </nav>

            <div className="px-2 pb-5 pt-3 border-t border-white/[0.06]" style={{ paddingBottom: 'max(1.25rem, var(--app-safe-bottom))' }}>
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                <NexusLogoAvatar size="xs" />
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-white block truncate">Hello Everyone</span>
                  <span className="text-[9px] text-emerald-400/80 font-semibold">Active License</span>
                </div>
              </div>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
