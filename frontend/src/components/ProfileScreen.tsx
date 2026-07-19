import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Zap,
  LogOut,
  CheckCircle,
  Calendar,
} from 'lucide-react';
import NexusLogoAvatar from './NexusLogoAvatar';
import { clearNexusUser, refreshLicenseStatus } from '../lib/nexusUser';
import { getDeviceFingerprint } from '../lib/deviceFingerprint';
import type { NexusUser } from '../types';

const TIER_LABELS: Record<NexusUser['tier'], string> = {
  basic: 'BASIC PLAN',
  pro: 'PRO PLAN',
  premium: 'PREMIUM VIP',
  regular: 'REGULAR UNLIMITED',
};

interface ProfileScreenProps {
  user: NexusUser;
  onUserUpdate: (user: NexusUser) => void;
}

function isUnlimitedDaily(limit: number): boolean {
  return limit < 0;
}

function formatLimit(limit: number): string {
  return isUnlimitedDaily(limit) ? '∞' : String(limit);
}

function formatActivatedDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export default function ProfileScreen({ user, onUserUpdate }: ProfileScreenProps) {
  const [userData, setUserData] = useState<NexusUser>(user);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setUserData(user);
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      setRefreshing(true);
      try {
        const fp = userData.deviceFingerprint || (await getDeviceFingerprint());
        const status = await refreshLicenseStatus(userData.licenseKey, fp);
        if (cancelled) return;

        const updated: NexusUser = {
          ...userData,
          tier: status.tier,
          dailyLimit: status.dailyLimit,
          deviceLimit: status.deviceLimit,
          holderName: status.holderName,
          deviceFingerprint: fp,
          usedToday: status.usage.usedToday,
          remaining: status.usage.remaining,
          totalScans: status.usage.totalScans,
          devicesUsed: status.devicesUsed,
          licenseCreatedAt: status.createdAt,
        };
        setUserData(updated);
        onUserUpdate(updated);
      } catch {
        // keep cached profile if refresh fails
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [userData.licenseKey]);

  const handleLogout = () => {
    clearNexusUser();
    window.location.reload();
  };

  const radius = 28;
  const circumference = 2 * Math.PI * radius;

  const totalScans = userData.totalScans ?? 0;
  const usedToday = userData.usedToday ?? 0;
  const dailyLimit = userData.dailyLimit ?? 0;
  const scansRing = Math.min(1, (totalScans % 1000) / 1000);
  const usagePct = isUnlimitedDaily(dailyLimit)
    ? Math.min(100, usedToday > 0 ? 18 : 0)
    : dailyLimit > 0
      ? Math.min(100, (usedToday / dailyLimit) * 100)
      : 0;
  const signalsLeftLabel = isUnlimitedDaily(dailyLimit)
    ? `${usedToday} used · ∞ left`
    : `${userData.remaining ?? 0}/${dailyLimit} signals left today`;
  const devicesUsed = userData.devicesUsed ?? 0;
  const deviceLimit = userData.deviceLimit ?? 1;
  const devicesPct =
    deviceLimit < 0 ? 100 : deviceLimit > 0 ? Math.min(100, (devicesUsed / deviceLimit) * 100) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-6 pb-4 overscroll-contain scrollbar-none w-full lg:max-w-4xl lg:mx-auto">
        <div className="relative p-5 rounded-xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.07] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_15px_30px_-5px_rgba(0,0,0,0.5)] flex flex-col items-center text-center space-y-4">
          <div className="relative">
            <div className="absolute -inset-1.5 rounded-xl border border-amber-400/40 animate-pulse" />
            <div className="relative z-10 shadow-xl">
              <NexusLogoAvatar size="xl" rounded="xl" className="border-2 border-white/20" />
            </div>
          </div>

          <div className="space-y-1 relative z-10">
            <div className="flex items-center justify-center space-x-1.5">
              <h2 className="text-[18px] font-extrabold text-white tracking-tight leading-none">
                {userData.telegram.startsWith('@') ? userData.telegram : `@${userData.telegram}`}
              </h2>
              <CheckCircle className="w-4.5 h-4.5 text-amber-400 fill-amber-400/20" />
            </div>
            <p className="text-[11px] text-white/50 font-bold font-mono tracking-widest uppercase truncate max-w-[280px]">
              {userData.holderName || userData.telegram}
            </p>
            <p className="text-[9px] text-amber-400/80 font-mono tracking-widest uppercase pt-1">
              KEY: {userData.licenseKey}
            </p>
            <p className="text-[10px] text-emerald-400/90 font-bold uppercase tracking-wider pt-2">
              {TIER_LABELS[userData.tier]} · {signalsLeftLabel}
              {refreshing ? ' · syncing…' : ''}
            </p>
          </div>

          <div className="inline-flex items-center space-x-1.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 px-4 py-1.5 rounded-full">
            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20" />
            <span className="text-[10px] font-extrabold text-amber-400 uppercase tracking-widest">
              {TIER_LABELS[userData.tier]}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[12px] font-extrabold text-white/40 uppercase tracking-widest pl-2">
            Trading Metrics
          </h3>

          <div className="grid grid-cols-3 gap-3">
            <StatRing
              label="Used Today"
              value={String(usedToday)}
              suffix={isUnlimitedDaily(dailyLimit) ? '' : `/${formatLimit(dailyLimit)}`}
              progress={usagePct / 100}
              colorClass="stroke-emerald-400"
              glow="rgba(52, 211, 153, 0.75)"
              textClass="text-emerald-400"
              circumference={circumference}
              radius={radius}
            />

            <StatRing
              label="Scans Done"
              value={String(totalScans)}
              suffix=""
              progress={scansRing}
              colorClass="stroke-amber-400"
              glow="rgba(251, 191, 36, 0.75)"
              textClass="text-amber-400"
              circumference={circumference}
              radius={radius}
              mono
            />

            <StatRing
              label="Devices"
              value={String(devicesUsed)}
              suffix={deviceLimit < 0 ? '/∞' : `/${deviceLimit}`}
              progress={devicesPct / 100}
              colorClass="stroke-blue-400"
              glow="rgba(96, 165, 250, 0.75)"
              textClass="text-blue-400"
              circumference={circumference}
              radius={radius}
              centerIcon={<Zap className="w-5 h-5 text-blue-400 fill-blue-400/20" />}
            />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[12px] font-extrabold text-white/40 uppercase tracking-widest pl-2">
            License Usage
          </h3>

          <div className="grid grid-cols-3 gap-3">
            <StatRing
              label="Daily Usage"
              value={usagePct.toFixed(1)}
              suffix="%"
              progress={usagePct / 100}
              colorClass="stroke-amber-500"
              glow="rgba(245, 158, 11, 0.75)"
              textClass="text-amber-500"
              circumference={circumference}
              radius={radius}
            />

            <StatRing
              label="Activated"
              value={formatActivatedDate(userData.licenseCreatedAt || userData.validatedAt)}
              progress={1}
              colorClass="stroke-indigo-400"
              glow="rgba(129, 140, 248, 0.75)"
              textClass="text-white/90"
              circumference={circumference}
              radius={radius}
              centerIcon={<Calendar className="w-4 h-4 text-indigo-400" />}
              smallValue
            />

            <StatRing
              label="Signal Limit"
              value={formatLimit(dailyLimit)}
              suffix="/day"
              progress={isUnlimitedDaily(dailyLimit) ? 1 : Math.min(1, dailyLimit / 100)}
              colorClass="stroke-amber-400"
              glow="rgba(251, 191, 36, 0.75)"
              textClass="text-amber-400"
              circumference={circumference}
              radius={radius}
              mono
            />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[12px] font-extrabold text-white/40 uppercase tracking-widest pl-2">
            Account & Support
          </h3>

          <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] overflow-hidden">
            <div
              onClick={handleLogout}
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/[0.02] transition duration-200"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                  <LogOut className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[13px] font-bold text-rose-400 tracking-tight leading-none">
                    Log Out
                  </div>
                  <div className="text-[10px] text-white/30 mt-1">
                    End secure active session
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-extrabold text-rose-500/70 uppercase tracking-widest mr-1">
                EXIT
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRing({
  label,
  value,
  suffix = '',
  progress,
  colorClass,
  glow,
  textClass,
  circumference,
  radius,
  centerIcon,
  mono,
  smallValue,
}: {
  label: string;
  value: string;
  suffix?: string;
  progress: number;
  colorClass: string;
  glow: string;
  textClass: string;
  circumference: number;
  radius: number;
  centerIcon?: React.ReactNode;
  mono?: boolean;
  smallValue?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.05] flex flex-col items-center space-y-3 text-center"
    >
      <div className="relative w-20 h-20 flex items-center justify-center">
        <svg className="absolute inset-0 w-20 h-20 transform -rotate-90">
          <circle
            cx="40"
            cy="40"
            r={radius}
            className="stroke-white/[0.03]"
            strokeWidth="5.5"
            fill="transparent"
          />
          <circle
            cx="40"
            cy="40"
            r={radius}
            className={colorClass}
            strokeWidth="5.5"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped)}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0px 0px 8px ${glow})` }}
          />
        </svg>
        <div className="relative z-10 flex flex-col items-center">
          {centerIcon ?? (
            <div className={`flex items-center justify-center ${textClass}`}>
              <span
                className={`${smallValue ? 'text-[9px]' : 'text-[14px]'} font-black tracking-tighter ${mono ? 'font-mono' : ''}`}
              >
                {value}
              </span>
              {suffix && (
                <span className="text-[8px] font-bold ml-0.5">{suffix}</span>
              )}
            </div>
          )}
          {centerIcon && !smallValue && (
            <span className={`text-[9px] font-black mt-0.5 ${textClass}`}>{value}</span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-white/50 font-black uppercase tracking-wider">{label}</span>
    </motion.div>
  );
}
