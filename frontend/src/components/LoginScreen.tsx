import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User,
  Key,
  Zap,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import type { NexusUser } from '../types';
import { validateLicenseApi } from '../lib/nexusUser';
import { getDeviceFingerprint } from '../lib/deviceFingerprint';
import NexusLogoAvatar from './NexusLogoAvatar';

const TELEGRAM_SUPPORT_URL = 'https://t.me/Owneraldifx';

interface LoginScreenProps {
  onActivate: (user: NexusUser) => void;
}

function TelegramHeaderButton() {
  return (
    <motion.a
      href={TELEGRAM_SUPPORT_URL}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.95 }}
      className="relative w-11 h-11 shrink-0 rounded-full flex items-center justify-center group select-none"
      aria-label="Contact support on Telegram"
    >
      <span className="absolute inset-0 rounded-full bg-[#24A1DE]/25 animate-ping opacity-50 pointer-events-none" />
      <span className="absolute inset-0 rounded-full bg-[#24A1DE]/15 blur-md opacity-60 group-hover:opacity-90 transition-opacity duration-300 pointer-events-none" />
      <div className="relative z-10 w-full h-full rounded-full bg-[#24A1DE] border border-[#3db5ef]/40 shadow-[0_0_16px_rgba(36,161,222,0.45)] flex items-center justify-center overflow-hidden group-hover:shadow-[0_0_22px_rgba(36,161,222,0.7)] transition-shadow duration-300">
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 text-white fill-current translate-x-[-1px] translate-y-[1px]"
          aria-hidden
        >
          <path d="M9.78 15.28l-.38 5.36c.54 0 .78-.23 1.06-.51l2.54-2.43 5.27 3.86c.97.53 1.66.25 1.92-.89l3.46-16.22h.01c.31-1.44-.52-2.01-1.46-1.67L1.17 9.59c-1.41.55-1.39 1.34-.24 1.7l5.47 1.71L19.5 6.1c.66-.43 1.26-.19.77.24" />
        </svg>
      </div>
    </motion.a>
  );
}

export default function LoginScreen({ onActivate }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [licenseKey, setLicenseKey] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUsername = username.trim();
    const trimmedLicense = licenseKey.trim();

    if (!trimmedUsername) {
      setError('Please enter your username!');
      return;
    }

    if (!trimmedLicense) {
      setError('Please enter the License Key!');
      return;
    }

    setIsActivating(true);

    try {
      const deviceFingerprint = await getDeviceFingerprint();
      if (!deviceFingerprint || deviceFingerprint.length < 16) {
        setError('Device identification failed. Open http://192.168.1.1:7777 and try again.');
        setIsActivating(false);
        return;
      }

      const result = await validateLicenseApi({
        key: trimmedLicense,
        telegram: trimmedUsername,
        deviceFingerprint,
      });

      setIsActivating(false);
      setSuccess(true);

      const user: NexusUser = {
        telegram: result.license.holderTelegram,
        licenseKey: result.license.key,
        tier: result.license.tier,
        dailyLimit: result.license.dailyLimit,
        deviceLimit: result.deviceLimit,
        holderName: result.license.holderName,
        deviceFingerprint,
        usedToday: result.usage?.usedToday ?? 0,
        remaining: result.usage?.remaining ?? result.license.dailyLimit,
        totalScans: result.usage?.totalScans ?? 0,
        devicesUsed: result.devicesUsed,
        validatedAt: new Date().toISOString(),
      };

      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const now = audioCtx.currentTime;
        const playTone = (freq: number, start: number, duration: number) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.1, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(start);
          osc.stop(start + duration);
        };
        playTone(523.25, now, 0.15);
        playTone(659.25, now + 0.1, 0.15);
        playTone(987.77, now + 0.2, 0.35);
      } catch {
        console.warn('Audio blocked');
      }

      setTimeout(() => {
        onActivate(user);
      }, 1000);
    } catch (err: unknown) {
      setIsActivating(false);
      setError(err instanceof Error ? err.message : 'Activation failed. Check your details.');
    }
  };

  return (
    <div className="w-full h-full flex flex-col justify-center px-4 py-8 relative">
      <AnimatePresence mode="wait">
        {!success ? (
          <motion.div
            key="login-form"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6"
          >
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.25)] px-3.5 py-3.5 select-none">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/[0.06] via-transparent to-white/[0.04]" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              <div className="relative flex items-center justify-between gap-2.5">
                <NexusLogoAvatar
                  size="md"
                  rounded="lg"
                  className="border border-white/10 shadow-md shrink-0"
                />
                <div className="min-w-0 flex-1 text-center px-1">
                  <h2 className="text-[15px] sm:text-[17px] font-black tracking-wide text-white leading-tight">
                    NEXUS AI ACTIVATION
                  </h2>
                  <p className="text-[9px] sm:text-[10px] text-white/50 font-bold tracking-normal leading-snug mt-0.5">
                    Enter your username and license key to activate
                  </p>
                </div>
                <TelegramHeaderButton />
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="p-3.5 rounded-2xl bg-rose-500/20 border border-rose-500/35 text-rose-300 text-[11px] font-bold flex items-start space-x-2 shadow-[0_4px_12px_rgba(244,63,94,0.1)]"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="flex-1 leading-normal">{error}</span>
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold text-white/45 uppercase tracking-wider block pl-1">
                  Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-white/30">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setError(null);
                    }}
                    placeholder="Enter Telegram Username"
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl py-3 pl-11 pr-4 text-white text-[12px] font-bold tracking-wide placeholder:text-white/20 focus:outline-none focus:border-amber-500/50 focus:bg-white/[0.05] transition-all duration-300"
                    disabled={isActivating}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold text-white/45 uppercase tracking-wider block pl-1">
                  License Key
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-white/30">
                    <Key className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={licenseKey}
                    onChange={(e) => {
                      setLicenseKey(e.target.value);
                      setError(null);
                    }}
                    placeholder="Enter License Key"
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl py-3 pl-11 pr-4 text-white text-[12px] font-mono font-bold tracking-widest placeholder:text-white/20 focus:outline-none focus:border-amber-500/50 focus:bg-white/[0.05] transition-all duration-300 uppercase"
                    disabled={isActivating}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isActivating}
                className="w-full mt-2 relative py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:from-white/10 disabled:to-white/10 text-white font-extrabold text-[12px] uppercase tracking-wider shadow-[0_8px_25px_-5px_rgba(245,158,11,0.25)] disabled:shadow-none active:scale-[0.98] transition-all duration-200 overflow-hidden flex items-center justify-center space-x-2 border border-white/10"
              >
                {isActivating ? (
                  <>
                    <Loader2 className="w-4.5 h-4.5 animate-spin text-white" />
                    <span>Activating...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 fill-white/10" />
                    <span>Activate Bot</span>
                  </>
                )}
              </button>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="login-success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-4 py-12 select-none"
          >
            <div className="inline-flex p-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.3)] animate-bounce">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            </div>
            <h2 className="text-[22px] font-extrabold text-white tracking-tight leading-none">
              Successfully Activated!
            </h2>
            <p className="text-[11px] text-emerald-400 font-bold uppercase tracking-wider">
              SUCCESSFULLY ACTIVATED!
            </p>
            <p className="text-[11px] text-white/50 max-w-[240px] mx-auto leading-normal">
              Your premium signals dashboard is loading...
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
