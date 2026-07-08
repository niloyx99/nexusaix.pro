import { motion } from 'motion/react';

interface CandleProps {
  bullish: boolean;
  bodyH: number;
  wickTop: number;
  wickBottom: number;
  delay: number;
  duration: number;
}

function AnimatedCandle({ bullish, bodyH, wickTop, wickBottom, delay, duration }: CandleProps) {
  const color = bullish ? '#34d399' : '#f87171';
  const bodyY = bullish ? wickTop + 2 : wickTop + wickBottom;

  return (
    <motion.svg
      width="14"
      height="52"
      viewBox="0 0 14 52"
      className="overflow-visible"
      animate={{ y: [0, -7, 3, -5, 0] }}
      transition={{
        duration,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
    >
      <line x1="7" y1="0" x2="7" y2={wickTop} stroke={color} strokeWidth="1.2" opacity="0.55" />
      <rect x="4" y={bodyY} width="6" height={bodyH} fill={color} rx="1" opacity="0.9" />
      <line
        x1="7"
        y1={bodyY + bodyH}
        x2="7"
        y2={wickTop + wickTop + wickBottom + bodyH}
        stroke={color}
        strokeWidth="1.2"
        opacity="0.55"
      />
    </motion.svg>
  );
}

const LEFT_CANDLES: Omit<CandleProps, 'delay' | 'duration'>[] = [
  { bullish: true, bodyH: 16, wickTop: 8, wickBottom: 6 },
  { bullish: false, bodyH: 12, wickTop: 12, wickBottom: 8 },
  { bullish: true, bodyH: 20, wickTop: 6, wickBottom: 4 },
  { bullish: false, bodyH: 14, wickTop: 10, wickBottom: 6 },
  { bullish: true, bodyH: 18, wickTop: 7, wickBottom: 5 },
];

const RIGHT_CANDLES: Omit<CandleProps, 'delay' | 'duration'>[] = [
  { bullish: false, bodyH: 14, wickTop: 10, wickBottom: 7 },
  { bullish: true, bodyH: 18, wickTop: 8, wickBottom: 5 },
  { bullish: false, bodyH: 11, wickTop: 14, wickBottom: 9 },
  { bullish: true, bodyH: 22, wickTop: 5, wickBottom: 4 },
  { bullish: false, bodyH: 13, wickTop: 11, wickBottom: 8 },
];

interface AnalysisLoaderProps {
  progress: number;
}

export default function AnalysisLoader({ progress }: AnalysisLoaderProps) {
  const pct = Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <div className="p-8 lg:p-10 rounded-[28px] bg-white/[0.03] border border-white/[0.07] shadow-xl flex flex-col items-center justify-center text-center min-h-[350px] lg:max-w-4xl lg:mx-auto lg:w-full relative overflow-hidden">
      <div className="flex items-center justify-center w-full max-w-sm gap-3 sm:gap-5">
        {/* Left candlesticks */}
        <div className="flex items-end justify-center gap-1 sm:gap-1.5 h-[56px] shrink-0 opacity-80">
          {LEFT_CANDLES.map((c, i) => (
            <AnimatedCandle
              key={`l-${i}`}
              {...c}
              delay={i * 0.18}
              duration={2.4 + (i % 3) * 0.3}
            />
          ))}
        </div>

        {/* Center ring + percentage */}
        <div className="flex flex-col items-center justify-center space-y-4 shrink-0 px-1">
          <div className="relative w-20 h-20 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-amber-400/20 animate-ping" />
            <div className="absolute inset-2 rounded-full border-2 border-amber-400/40 animate-pulse" />
            <div className="absolute inset-4 rounded-full border border-amber-400/60" />
            <span className="text-[22px] font-black text-amber-400 font-mono tabular-nums z-10">
              {pct}%
            </span>
          </div>

          <div className="w-full">
            <div className="w-36 h-1 rounded-full bg-white/[0.06] overflow-hidden mx-auto">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-amber-500/80 to-amber-300/90"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>

        {/* Right candlesticks */}
        <div className="flex items-end justify-center gap-1 sm:gap-1.5 h-[56px] shrink-0 opacity-80">
          {RIGHT_CANDLES.map((c, i) => (
            <AnimatedCandle
              key={`r-${i}`}
              {...c}
              delay={0.12 + i * 0.2}
              duration={2.6 + (i % 3) * 0.25}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
