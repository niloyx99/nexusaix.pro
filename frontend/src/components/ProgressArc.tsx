import React from 'react';
import { motion } from 'motion/react';

interface ProgressArcProps {
  percentage: number;
  color: 'yellow' | 'green' | 'blue';
  trend: 'up' | 'down';
}

export default function ProgressArc({ percentage, color, trend }: ProgressArcProps) {
  // SVG Circle calculations
  // Radius is 26. Circumference is 2 * Math.PI * 26 ≈ 163.36
  const radius = 26;
  const strokeWidth = 3.5;
  const circumference = 2 * Math.PI * radius;
  
  // We want an open arc of 270 degrees (3/4 of a circle)
  // Total arc length is 75% of circumference
  const arcLength = circumference * 0.75;
  const gapLength = circumference * 0.25;
  
  // Dash offset calculations:
  // How much of the arcLength is filled
  const strokeDashoffset = arcLength - (arcLength * percentage) / 100;

  // Colors config
  const colorConfigs = {
    yellow: {
      stroke: '#eab308', // Amber-500
      bg: 'rgba(234, 179, 8, 0.1)',
      text: 'text-amber-400',
      arrow: 'text-amber-400',
      shadow: 'shadow-[0_0_12px_rgba(234,179,8,0.3)]',
      glow: 'rgba(234,179,8,0.4)',
    },
    green: {
      stroke: '#22c55e', // Green-500
      bg: 'rgba(34, 197, 94, 0.1)',
      text: 'text-green-400',
      arrow: 'text-green-400',
      shadow: 'shadow-[0_0_12px_rgba(34,197,94,0.3)]',
      glow: 'rgba(34,197,94,0.4)',
    },
    blue: {
      stroke: '#3b82f6', // Blue-500
      bg: 'rgba(59, 130, 246, 0.1)',
      text: 'text-blue-400',
      arrow: 'text-blue-400',
      shadow: 'shadow-[0_0_12px_rgba(59,130,246,0.3)]',
      glow: 'rgba(59,130,246,0.4)',
    }
  };

  const config = colorConfigs[color];

  return (
    <div className="relative w-20 h-20 flex items-center justify-center select-none">
      {/* SVG Arc Container */}
      <svg
        className="w-full h-full -rotate-225" // Rotate to point the open gap downwards symmetrically
        viewBox="0 0 64 64"
      >
        <defs>
          <filter id={`glow-${color}`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track Circle (Base Gray/Translucent) */}
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="transparent"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${gapLength}`}
          strokeLinecap="round"
        />

        {/* Animated Progress Circle */}
        <motion.circle
          cx="32"
          cy="32"
          r={radius}
          fill="transparent"
          stroke={config.stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${gapLength}`}
          initial={{ strokeDashoffset: arcLength }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.4, ease: 'easeOut' }}
          strokeLinecap="round"
          filter={`url(#glow-${color})`}
        />
      </svg>

      {/* Percentage label in the center */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-0.5">
        <span className={`text-[13px] font-bold tracking-tight text-white/95`}>
          {percentage}%
        </span>
      </div>

      {/* Trend Arrow floating at top-right of progress container */}
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.8, type: 'spring', stiffness: 200 }}
        className="absolute -top-1.5 -right-1.5 flex items-center justify-center w-[18px] h-[18px]"
      >
        {trend === 'up' ? (
          <span className={`text-[15px] font-semibold leading-none ${config.arrow}`}>↗</span>
        ) : (
          <span className={`text-[15px] font-semibold leading-none ${config.arrow}`}>↘</span>
        )}
      </motion.div>
    </div>
  );
}
