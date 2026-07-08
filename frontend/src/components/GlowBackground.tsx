import React from 'react';

export default function GlowBackground() {
  return (
    <div className="fixed inset-0 -z-50 overflow-hidden bg-[#0d0f12] select-none">
      {/* Deep atmosphere bg layer */}
      <div className="absolute inset-0 bg-radial-at-t from-[#1b1215] via-[#0d0f12] to-[#0a0d0a] opacity-80" />

      {/* Top right Burgundy/Red glowing blur */}
      <div className="animate-glow-1 absolute -top-[10%] -right-[10%] w-[60%] h-[60%] rounded-full bg-[#3c141d]/40 blur-[120px]" />

      {/* Center right red glow */}
      <div className="animate-glow-2 absolute top-[30%] -right-[15%] w-[50%] h-[50%] rounded-full bg-[#45101a]/30 blur-[100px]" />

      {/* Bottom left Green glowing blur */}
      <div className="animate-glow-2 absolute -bottom-[10%] -left-[10%] w-[60%] h-[60%] rounded-full bg-[#0c2e17]/40 blur-[120px]" />

      {/* Floating accent orbs (from screenshot) */}
      {/* Yellow orb on left */}
      <div className="absolute top-[24%] left-[4%] sm:left-[8%] md:left-[15%] lg:left-[25%] xl:left-[30%] w-3 h-3 rounded-full bg-[#eab308] opacity-80 blur-[1px] shadow-[0_0_12px_4px_rgba(234,179,8,0.5)] transition-all duration-500" />

      {/* Green orb on bottom right */}
      <div className="absolute bottom-[18%] right-[4%] sm:right-[8%] md:right-[15%] lg:right-[25%] xl:right-[30%] w-3.5 h-3.5 rounded-full bg-[#22c55e] opacity-80 blur-[1px] shadow-[0_0_14px_4px_rgba(34,197,94,0.5)] transition-all duration-500" />
    </div>
  );
}
