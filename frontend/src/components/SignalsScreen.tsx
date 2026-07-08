import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Compass, 
  Zap, 
  ArrowUpRight, 
  ArrowDownRight, 
  Loader2, 
  Clock,
  Check,
  Copy,
  Bell,
  BellRing,
  AlertCircle,
  ClipboardCheck,
  XCircle,
  CheckCircle2,
  BarChart3,
  Percent
} from 'lucide-react';
import NexusLogoAvatar from './NexusLogoAvatar';
import AnalysisLoader from './AnalysisLoader';
import { getLicenseHeaders } from '../lib/nexusUser';
import { apiUrl } from '../lib/api';

interface Signal {
  id: string;
  time: string;
  pair: string;
  direction: 'CALL' | 'PUT';
  duration: '1 Min';
  confidence: number;
  engineScore?: number;
  daisyScore?: number;
  reasons?: string[];
}

export default function SignalsScreen() {
  const [marketType, setMarketType] = useState<'REAL' | 'OTC'>('REAL');
  const [signalCount, setSignalCount] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generatedSignals, setGeneratedSignals] = useState<Signal[]>([]);
  const [copied, setCopied] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [lastCheckedMinute, setLastCheckedMinute] = useState<string>('');
  const [activeAlarmMessage, setActiveAlarmMessage] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [checkerText, setCheckerText] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState(0);
  const [checkResult, setCheckResult] = useState<string | null>(null);
  const [checkSummary, setCheckSummary] = useState<{
    total: number;
    profit: number;
    mtgProfit: number;
    mtgLoss: number;
    pending: number;
    unknown: number;
    accuracyPct: number;
  } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkerCopied, setCheckerCopied] = useState(false);

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    if (!text) return false;

    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to legacy copy for mobile / HTTP LAN
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);

      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  };

  // Simple synthesizer using Web Audio API to support alerts directly in browser
  const playAlertSound = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playTone = (freq: number, start: number, duration: number, type: 'sine' | 'square' | 'triangle' = 'sine') => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.1, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + duration);
      };

      const now = audioCtx.currentTime;
      // Beautiful triple-synth alert sound
      playTone(523.25, now, 0.1); // C5
      playTone(659.25, now + 0.08, 0.1); // E5
      playTone(783.99, now + 0.16, 0.2, 'triangle'); // G5
    } catch (e) {
      console.warn("AudioContext blocked or not supported yet", e);
    }
  };

  useEffect(() => {
    if (!isGenerating) {
      setGenerateProgress(0);
      return;
    }

    setGenerateProgress(6);
    const interval = setInterval(() => {
      setGenerateProgress((prev) => {
        if (prev >= 90) return prev;
        const step = prev < 40 ? 8 : prev < 70 ? 5 : 2;
        return Math.min(90, prev + step);
      });
    }, 350);

    return () => clearInterval(interval);
  }, [isGenerating]);

  useEffect(() => {
    if (!isChecking) {
      setCheckProgress(0);
      return;
    }
    setCheckProgress(10);
    const interval = setInterval(() => {
      setCheckProgress((prev) => Math.min(92, prev + 8));
    }, 400);
    return () => clearInterval(interval);
  }, [isChecking]);

  const handleCheckSignals = async () => {
    if (!checkerText.trim()) {
      setCheckError('Paste your signal list first.');
      return;
    }
    setIsChecking(true);
    setCheckError(null);
    setCheckResult(null);
    setCheckSummary(null);
    setCheckProgress(12);

    try {
      const response = await fetch(apiUrl('/api/signals/check'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getLicenseHeaders(),
        },
        body: JSON.stringify({ text: checkerText }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        setCheckError(payload.error || 'Signal check failed.');
        return;
      }
      setCheckProgress(100);
      setCheckResult(payload.data.formatted);
      setCheckSummary({
        total: payload.data.total,
        profit: payload.data.profit,
        mtgProfit: payload.data.mtgProfit,
        mtgLoss: payload.data.mtgLoss,
        pending: payload.data.pending ?? 0,
        unknown: payload.data.unknown,
        accuracyPct: payload.data.accuracyPct,
      });
    } catch (err: unknown) {
      setCheckError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setIsChecking(false);
    }
  };

  const handleCopyCheckerResult = async () => {
    if (!checkResult) return;
    const ok = await copyTextToClipboard(checkResult);
    if (ok) {
      setCheckerCopied(true);
      setTimeout(() => setCheckerCopied(false), 2000);
    }
  };

  // Check every second if any generated signals match the current local time (hour:minute)
  useEffect(() => {
    const interval = setInterval(() => {
      if (generatedSignals.length === 0) return;

      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const currentMinuteStr = `${hh}:${mm}`;

      if (currentMinuteStr !== lastCheckedMinute) {
        setLastCheckedMinute(currentMinuteStr);

        // Check if there is a signal matching current time exactly
        const match = generatedSignals.find(sig => sig.time === currentMinuteStr);
        if (match) {
          playAlertSound();
          const cleanPair = match.pair.replace('/', '').replace('-OTC', '');
          setActiveAlarmMessage(`🚨 ALARM: Active Signal for ${cleanPair} (${match.direction})!`);
          
          // Clear notification automatically after 10 seconds
          setTimeout(() => {
            setActiveAlarmMessage(null);
          }, 10000);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [generatedSignals, lastCheckedMinute, soundEnabled]);

  const handleGenerateSignals = async () => {
    if (!signalCount) return;
    setIsGenerating(true);
    setGenerateProgress(8);
    setActiveAlarmMessage(null);
    setGenerateError(null);

    try {
      const response = await fetch(apiUrl('/api/signals/generate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getLicenseHeaders(),
        },
        body: JSON.stringify({ marketType, count: signalCount }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        const failures: string[] = Array.isArray(payload.failures)
          ? payload.failures
          : [payload.error || payload.message || 'Signal generation failed'];
        setGenerateError(failures.join(' • '));
        setGeneratedSignals([]);
        return;
      }

      const data = payload.data;
      setGenerateProgress(100);
      setGeneratedSignals(data.signals || []);
      playAlertSound();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setGenerateError(msg);
      setGeneratedSignals([]);
    } finally {
      setIsGenerating(false);
    }
  };

  const getFormattedSignalsText = () => {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const dateStr = `${day}/${month}/${year}`;

    let text = `🗓𝗗𝗔𝗧𝗘 -${dateStr}\n`;
    text += `⏰𝗧𝗜𝗠𝗘 𝗭𝗢𝗡𝗘 - ( 𝗨𝗧𝗖 +𝟲:𝟬𝟬 )\n`;
    text += `📊𝟭 𝗠𝗜𝗡𝗨𝗧𝗘 𝗦𝗜𝗚𝗡𝗔𝗟𝗦\n`;
    text += `⭐️𝟭 𝗦𝗧𝗘𝗣 𝗠𝗧𝗚 𝗜𝗙 𝗡𝗘𝗘𝗗\n\n`;
    text += `╔══☠️ ALDI FX OFFICIAL ☠️══╗\n\n`;

    generatedSignals.forEach((sig) => {
      // Format to matching pattern e.g. M1;EURUSD;14:35;CALL
      const cleanPair = sig.pair.replace('/', '').replace('-OTC', '');
      text += `M1;${cleanPair};${sig.time};${sig.direction}\n`;
    });

    text += `\n╚══☠️ ALDI FX OFFICIAL  ☠️ ══╝`;
    return text;
  };

  const handleCopyAll = async () => {
    if (generatedSignals.length === 0) return;
    const formattedText = getFormattedSignalsText();
    const ok = await copyTextToClipboard(formattedText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setGenerateError('Copy failed — tap and hold the signal text to copy manually.');
      setTimeout(() => setGenerateError(null), 3000);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Scrollable Container */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-4 lg:space-y-6 pb-4 overscroll-contain scrollbar-none lg:max-w-6xl">
        {/* Header Bar — mobile/tablet only */}
        <div className="lg:hidden flex items-center justify-between px-4 h-16 rounded-[24px] bg-black/10 backdrop-blur-2xl border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.02)] select-none max-lg:mt-1">
          <div className="w-10 h-10 rounded-2xl bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)] flex items-center justify-center cursor-pointer hover:bg-white/[0.08] hover:scale-105 transition duration-200">
            <div className="grid grid-cols-2 gap-1.5 w-4.5 h-4.5 group">
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
            </div>
          </div>

          <div className="flex-1 flex justify-center">
            <span className="text-[14px] font-black tracking-[0.25em] text-white select-none drop-shadow-[0_0_10px_rgba(255,255,255,0.45)]">
              NEXUS AI
            </span>
          </div>

          <div className="w-10 h-10 rounded-2xl bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)] flex items-center justify-center cursor-pointer hover:bg-white/[0.08] hover:scale-105 transition duration-200 p-1">
            <NexusLogoAvatar size="xs" />
          </div>
        </div>

        {/* Floating Alarm Alert Banner */}
        <AnimatePresence>
          {activeAlarmMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-extrabold tracking-wide flex items-center space-x-2.5 shadow-[0_0_20px_rgba(16,185,129,0.25)] animate-bounce"
            >
              <BellRing className="w-4 h-4 text-emerald-400 animate-pulse flex-shrink-0" />
              <div className="flex-1 leading-tight">{activeAlarmMessage}</div>
              <button 
                onClick={() => setActiveAlarmMessage(null)}
                className="text-white/40 hover:text-white px-2 py-1 text-[10px] font-black bg-white/5 rounded-md"
              >
                DISMISS
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Generator + Output — 2 columns on desktop */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start space-y-4 lg:space-y-0">
        {/* Generator Controls Card */}
        <div className="p-4 lg:p-6 rounded-[28px] bg-white/[0.03] backdrop-blur-xl border border-white/[0.07] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_15px_30px_-5px_rgba(0,0,0,0.5)] space-y-3.5">
          {/* Market Selection */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-extrabold text-white/40 uppercase tracking-widest pl-1">
              Market Selection
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMarketType('REAL')}
                className={`p-2.5 rounded-xl border text-center transition-all duration-300 relative overflow-hidden ${
                  marketType === 'REAL'
                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.1)] font-bold'
                    : 'bg-white/[0.01] border-white/[0.05] text-white/60 hover:text-white hover:bg-white/[0.02]'
                }`}
              >
                <span className="text-[10px] uppercase tracking-wider block">🟢 Real Market</span>
              </button>
              <button
                type="button"
                onClick={() => setMarketType('OTC')}
                className={`p-2.5 rounded-xl border text-center transition-all duration-300 relative overflow-hidden ${
                  marketType === 'OTC'
                    ? 'bg-amber-500/15 border-amber-500/35 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.1)] font-bold'
                    : 'bg-white/[0.01] border-white/[0.05] text-white/60 hover:text-white hover:bg-white/[0.02]'
                }`}
              >
                <span className="text-[10px] uppercase tracking-wider block">🟡 OTC Market</span>
              </button>
            </div>
          </div>

          {/* Number of Signals Selector */}
          <div className="space-y-1.5">
            <label className="text-[9px] font-extrabold text-white/40 uppercase tracking-widest pl-1">
              Quantity Selection
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {[5, 10, 15, 20].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setSignalCount(count)}
                  className={`py-2 text-[10px] font-bold rounded-lg border transition-all duration-200 ${
                    signalCount === count
                      ? 'bg-white/10 border-white/25 text-white shadow-[0_4px_12px_rgba(255,255,255,0.05)]'
                      : 'bg-transparent border-white/[0.04] text-white/40 hover:bg-white/[0.01]'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          {/* Generator Action Button */}
          <button
            type="button"
            disabled={isGenerating || !signalCount}
            onClick={handleGenerateSignals}
            className="w-full relative py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 disabled:from-white/10 disabled:to-white/10 text-white font-extrabold text-[11px] uppercase tracking-widest shadow-[0_8px_25px_-5px_rgba(16,185,129,0.3)] disabled:shadow-none active:scale-[0.98] transition-all duration-200 overflow-hidden flex items-center justify-center space-x-2 border border-white/10"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>GENERATING SIGNALS...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-white/15 animate-pulse" />
                <span>GENERATE FUTURE SIGNALS</span>
              </>
            )}
          </button>

          {isGenerating && <AnalysisLoader progress={generateProgress} />}

          {generateError && !isGenerating && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-rose-300 font-medium leading-relaxed">{generateError}</p>
            </div>
          )}
        </div>

        {/* Generated Signal Output */}
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {generatedSignals.length === 0 && !isGenerating ? (
              <div className="rounded-[28px] border border-dashed border-white/[0.06] p-10 flex flex-col items-center justify-center text-center bg-white/[0.01] min-h-[180px]">
                <Compass className="w-12 h-12 text-white/20 mb-3.5 stroke-[1.1] animate-spin-slow" />
                <p className="text-[12px] font-bold text-white/60">No Live Signals Yet</p>
                <p className="text-[10px] text-white/35 max-w-[220px] mt-1.5 leading-normal">
                  Select your market category, choose the desired signal output amount, and click generate to populate analytical signals.
                </p>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative rounded-[28px] bg-white/[0.03] backdrop-blur-xl border border-white/[0.07] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_15px_30px_-5px_rgba(0,0,0,0.5)] p-5 pt-14 font-mono text-[10px] lg:text-[11px] text-white/90 leading-relaxed overflow-x-auto whitespace-pre-wrap break-words selection:bg-emerald-500/30 select-text max-h-[350px] lg:max-h-[calc(100vh-220px)] lg:min-h-[400px] scrollbar-thin [-webkit-user-select:text] [user-select:text]"
              >
                {/* Copy Button — works on mobile HTTP via fallback */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void handleCopyAll();
                  }}
                  className="absolute top-3.5 right-3.5 z-10 flex items-center space-x-1.5 py-2 px-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] active:scale-[0.97] border border-white/[0.12] transition-all duration-200 text-[9px] font-black uppercase tracking-wider touch-manipulation"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-white/80" />
                      <span>Copy All</span>
                    </>
                  )}
                </button>
                
                <div className="select-text">
                  {getFormattedSignalsText()}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </div>

        {/* Future Signal Checker */}
        <div className="p-4 lg:p-6 rounded-[28px] bg-white/[0.03] backdrop-blur-xl border border-white/[0.07] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_15px_30px_-5px_rgba(0,0,0,0.5)] space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-[13px] font-black text-white uppercase tracking-wider">
                Future Signal Checker
              </h3>
              <p className="text-[10px] text-white/40 mt-1">
                Paste M1 signals · ✅ profit · ❌• MTG loss · ⏳ pending (future)
              </p>
            </div>
            <ClipboardCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          </div>

          <textarea
            value={checkerText}
            onChange={(e) => setCheckerText(e.target.value)}
            placeholder={`Paste signals here...\nM1;CADJPY;12:10;PUT\nM1;AUDJPY;12:13;CALL`}
            rows={8}
            className="w-full px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.08] text-white/90 text-[10px] lg:text-[11px] font-mono leading-relaxed placeholder:text-white/25 focus:outline-none focus:border-emerald-500/35 resize-y min-h-[140px]"
          />

          <button
            type="button"
            disabled={isChecking || !checkerText.trim()}
            onClick={handleCheckSignals}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 disabled:from-white/10 disabled:to-white/10 text-white font-extrabold text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 border border-white/10 active:scale-[0.98] transition-all"
          >
            {isChecking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>CHECKING SIGNALS...</span>
              </>
            ) : (
              <>
                <ClipboardCheck className="w-4 h-4" />
                <span>CHECK SIGNALS</span>
              </>
            )}
          </button>

          {isChecking && <AnalysisLoader progress={checkProgress} />}

          {checkError && !isChecking && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-rose-300">{checkError}</p>
            </div>
          )}

          {checkSummary && checkResult && !isChecking && (
            <div className="space-y-3">
              <div className="grid grid-cols-5 gap-1.5">
                <MiniStat icon={CheckCircle2} label="Profit" value={checkSummary.profit + checkSummary.mtgProfit} color="text-emerald-400" />
                <MiniStat icon={XCircle} label="MTG Loss" value={checkSummary.mtgLoss} color="text-rose-400" />
                <MiniStat icon={Clock} label="Pending" value={checkSummary.pending} color="text-sky-400" />
                <MiniStat icon={BarChart3} label="Total" value={checkSummary.total} color="text-white" />
                <MiniStat icon={Percent} label="ACC" value={`${checkSummary.accuracyPct}%`} color="text-amber-400" />
              </div>

              <div className="relative rounded-[20px] bg-black/20 border border-white/[0.06] p-4 pt-12 font-mono text-[10px] text-white/90 whitespace-pre-wrap break-words max-h-[320px] overflow-y-auto">
                <button
                  type="button"
                  onClick={() => void handleCopyCheckerResult()}
                  className="absolute top-3 right-3 flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-white/[0.08] border border-white/[0.1] text-[9px] font-bold uppercase"
                >
                  {checkerCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {checkerCopied ? 'Copied' : 'Copy'}
                </button>
                {checkResult}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
      <Icon className={`w-3.5 h-3.5 mx-auto mb-1 ${color}`} />
      <div className={`text-[14px] font-black ${color}`}>{value}</div>
      <div className="text-[8px] text-white/40 font-bold uppercase tracking-wider">{label}</div>
    </div>
  );
}
