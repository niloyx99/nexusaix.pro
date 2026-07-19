import React from 'react';
import NexusLogoAvatar from './NexusLogoAvatar';

interface MobileAppHeaderProps {
  onOpenMenu: () => void;
}

export default function MobileAppHeader({ onOpenMenu }: MobileAppHeaderProps) {
  return (
    <div
      className="lg:hidden flex items-center justify-between px-4 h-16 rounded-xl bg-black/10 backdrop-blur-2xl border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.02)] select-none shrink-0"
      style={{ marginTop: 'var(--app-safe-top, 0px)' }}
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)] flex items-center justify-center cursor-pointer hover:bg-white/[0.08] active:scale-95 transition duration-200"
      >
        <div className="grid grid-cols-2 gap-1.5 w-4.5 h-4.5">
          <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
          <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
          <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
          <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
        </div>
      </button>

      <div className="flex-1 flex justify-center">
        <span className="text-[14px] font-black tracking-[0.25em] text-white select-none drop-shadow-[0_0_10px_rgba(255,255,255,0.45)]">
          NEXUS AI
        </span>
      </div>

      <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)] flex items-center justify-center p-1">
        <NexusLogoAvatar size="xs" />
      </div>
    </div>
  );
}
