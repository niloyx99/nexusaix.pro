import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UploadCloud, Sparkles, X, Info, BarChart2, Compass, ChevronDown, ChevronUp } from 'lucide-react';
import ProgressArc from './ProgressArc';
import AnalysisLoader from './AnalysisLoader';
import NexusLogoAvatar from './NexusLogoAvatar';
import { getLicenseHeaders } from '../lib/nexusUser';
import { apiUrl, fetchWithRetry } from '../lib/api';
import { CHART_PASTE_EVENT } from '../utils/clipboardImage';
import { compressChartImage } from '../utils/compressChartImage';

interface AnalysisResult {
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  winRatePct: number;
  winRateVal: string;
  supportVal: string;
  supportPct: number;
  resistanceVal: string;
  resistancePct: number;
  signalQualityVal: string;
  signalQualityPct: number;
  analysisTitle: string;
  marketType?: 'REAL' | 'OTC';
  analysisText: string;
  recommendation: 'STRONG BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG SELL';
  nextCandleDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
  fusionConfidencePct?: number;
  fusionConfidenceVal?: string;
  payoutPercent?: number | null;
  marketMomentum?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  quotexPair?: string;
  analysisSources?: {
    gemini: { model: string; status: string };
    marketData: {
      status: string;
      pair: string;
      candlesUsed: number;
      payoutPercent: number | null;
    };
  };
}


export default function DashboardScreenOne() {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [connectionToast, setConnectionToast] = useState<string | null>(null);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [marketFeedReady, setMarketFeedReady] = useState<boolean | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteHint, setPasteHint] = useState(false);
  const pasteHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAnalyzing) {
      setAnalysisProgress(0);
      return;
    }

    setAnalysisProgress(5);
    const interval = setInterval(() => {
      setAnalysisProgress((prev) => {
        if (prev >= 92) return prev;
        const step = prev < 35 ? 7 : prev < 65 ? 5 : prev < 85 ? 3 : 1;
        return Math.min(92, prev + step);
      });
    }, 380);

    return () => clearInterval(interval);
  }, [isAnalyzing]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const flashConnectionToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setConnectionToast(message);
    toastTimerRef.current = setTimeout(() => setConnectionToast(null), 650);
  };

  const checkMarketFeed = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetchWithRetry(apiUrl('/api/market-data/status'), undefined, 1);
      const data = await response.json();
      const ok = Boolean(data?.success);
      setMarketFeedReady(ok);
      return ok;
    } catch {
      setMarketFeedReady(false);
      return false;
    }
  }, []);

  useEffect(() => {
    void checkMarketFeed();
    const timer = setInterval(() => {
      void checkMarketFeed();
    }, 45_000);
    return () => clearInterval(timer);
  }, [checkMarketFeed]);

  const flashPasteHint = useCallback(() => {
    if (pasteHintTimerRef.current) clearTimeout(pasteHintTimerRef.current);
    setPasteHint(true);
    pasteHintTimerRef.current = setTimeout(() => setPasteHint(false), 1200);
  }, []);

  const resetForNewAnalysis = useCallback(() => {
    setScreenshot(null);
    setAnalysisResult(null);
    setAnalysisExpanded(false);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const triggerAutoAnalyze = useCallback(async (imgData: string) => {
    setIsAnalyzing(true);
    setAnalysisProgress(8);
    setError(null);

    const feedOk = await checkMarketFeed();
    if (!feedOk) {
      flashConnectionToast('Market data offline — analysis paused to save your scan.');
      setError('Market data feed is offline. Analysis will not run until the live feed reconnects.');
      setIsAnalyzing(false);
      return;
    }

    try {
      // Never retry analyze — each attempt burns Gemini tokens.
      const response = await fetch(apiUrl('/api/analyze'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getLicenseHeaders(),
        },
        body: JSON.stringify({ image: imgData }),
      });

      const data = await response.json();

      if (!response.ok) {
        const reasons: string[] = Array.isArray(data?.failures) && data.failures.length
          ? data.failures
          : [data?.error || data?.message || 'Analysis Failed'];

        const code = typeof data?.code === 'string' ? data.code : '';
        const isMarketIssue =
          code === 'MARKET_DATA_OFFLINE' ||
          code === 'MARKET_DATA_UNAVAILABLE' ||
          reasons.some((reason) => /market data|market pair|live candles/i.test(reason));

        reasons.forEach((reason, index) => {
          setTimeout(() => flashConnectionToast(reason), index * 700);
        });

        if (isMarketIssue) {
          setError(reasons.join(' '));
        } else {
          resetForNewAnalysis();
        }
        return;
      }

      setAnalysisProgress(100);
      setAnalysisExpanded(false);
      setAnalysisResult(data);
    } catch (err: unknown) {
      console.warn('Analysis notice:', err);
      flashConnectionToast('Analysis Failed');
      resetForNewAnalysis();
    } finally {
      setIsAnalyzing(false);
    }
  }, [checkMarketFeed, resetForNewAnalysis]);

  const processFile = useCallback((file: File | Blob) => {
    const normalized = file instanceof File ? file : new File([file], 'pasted-chart.png', { type: 'image/png' });
    const isImage =
      normalized.type.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|bmp)$/i.test(normalized.name);

    if (!isImage) {
      setError('Please upload a valid image file.');
      return;
    }

    setError(null);
    flashPasteHint();
    const reader = new FileReader();
    reader.onload = async (event) => {
      if (event.target?.result) {
        const raw = event.target.result as string;
        const base64Img = await compressChartImage(raw);
        setScreenshot(base64Img);
        setAnalysisResult(null);
        setAnalysisExpanded(false);
        triggerAutoAnalyze(base64Img);
      }
    };
    reader.onerror = () => {
      setError('Failed to read image file.');
    };
    reader.readAsDataURL(normalized);
  }, [flashPasteHint, triggerAutoAnalyze]);

  useEffect(() => {
    const onChartPaste = (event: Event) => {
      const custom = event as CustomEvent<File>;
      if (custom.detail) processFile(custom.detail);
    };
    window.addEventListener(CHART_PASTE_EVENT, onChartPaste);
    return () => window.removeEventListener(CHART_PASTE_EVENT, onChartPaste);
  }, [processFile]);

  useEffect(() => {
    return () => {
      if (pasteHintTimerRef.current) clearTimeout(pasteHintTimerRef.current);
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleClear = () => {
    resetForNewAnalysis();
    setConnectionToast(null);
  };

  // Helper parser for simple formatting of Markdown lists and bold values returned by Gemini
  const parseAndRenderMarkdown = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('###')) {
        return (
          <h3 key={idx} className="text-[14px] font-bold text-white tracking-wide pt-4 pb-1.5 first:pt-0">
            {trimmed.replace(/^###\s*/, '')}
          </h3>
        );
      }
      if (trimmed.startsWith('####')) {
        return (
          <h4 key={idx} className="text-[12px] font-bold text-white/90 tracking-wide pt-3 pb-1">
            {trimmed.replace(/^####\s*/, '')}
          </h4>
        );
      }
      if (trimmed.startsWith('*') || trimmed.startsWith('-')) {
        const content = trimmed.replace(/^[\*\-]\s*/, '');
        return (
          <div key={idx} className="flex items-start space-x-2 pl-1 py-1">
            <span className="text-amber-400 text-[12px] pt-1">✦</span>
            <span className="text-[12px] text-white/70 leading-relaxed flex-1">
              {formatBoldText(content)}
            </span>
          </div>
        );
      }
      if (trimmed === '') {
        return <div key={idx} className="h-2" />;
      }
      return (
        <p key={idx} className="text-[12px] text-white/70 leading-relaxed py-1">
          {formatBoldText(trimmed)}
        </p>
      );
    });
  };

  const getAnalysisPreview = (text: string, maxLen = 160): string => {
    if (!text) return '';
    const plain = text
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/^[\*\-]\s+/gm, '')
      .replace(/\n+/g, ' ')
      .trim();
    if (plain.length <= maxLen) return plain;
    return plain.slice(0, maxLen).trimEnd() + '…';
  };

  const formatBoldText = (text: string) => {
    const parts = text.split(/\*\*([^*]+)\*\*/g);
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return <strong key={i} className="font-extrabold text-white">{part}</strong>;
      }
      return part;
    });
  };

  // Dynamically map KPI parameters based on the current analysis result
  const kpiData = {
    confidence: {
      title: 'Market Confidence',
      desc: 'Estimated Win Probability',
      val: analysisResult ? analysisResult.winRateVal : '72% WIN RATE',
      pct: analysisResult ? analysisResult.winRatePct : 72,
      trend: 'up' as const,
      color: 'green' as const,
    },
    support: {
      title: 'Key Support Level',
      desc: 'Strong Buyer Rebound Zone',
      val: analysisResult ? analysisResult.supportVal : '0.57800',
      pct: analysisResult ? analysisResult.supportPct : 85,
      trend: 'up' as const,
      color: 'blue' as const,
    },
    resistance: {
      title: 'Key Resistance Level',
      desc: 'Strong Seller Rejection Zone',
      val: analysisResult ? analysisResult.resistanceVal : '0.58250',
      pct: analysisResult ? analysisResult.resistancePct : 78,
      trend: 'down' as const,
      color: 'yellow' as const,
    },
    quality: {
      title: 'Signal Quality',
      desc: 'Overall Trend Power',
      val: analysisResult ? `${analysisResult.signalQualityVal} TREND` : 'STRONG TREND',
      pct: analysisResult ? analysisResult.signalQualityPct : 82,
      trend: 'up' as const,
      color: 'green' as const,
    }
  };

  const getCleanTitle = (fullTitle: string) => {
    if (!fullTitle) return '';
    return fullTitle
      .replace(/\s*\(OTC\)/gi, '')
      .replace(/\s*\(REAL\)/gi, '')
      .replace(/\s*\d+[- ]Minute\s+Chart\s+Analysis/gi, '')
      .replace(/\s*\d+[- ]Min\s+Chart\s+Analysis/gi, '')
      .replace(/\s*\d+[- ]Minute\s+Chart/gi, '')
      .replace(/\s*\d+[- ]Min\s+Chart/gi, '')
      .replace(/\s*\d+[- ]Minute\s*/gi, '')
      .replace(/\s*\d+[- ]Min\s*/gi, '')
      .replace(/\s*1-Minute/gi, '')
      .replace(/\s*5-Minute/gi, '')
      .replace(/\s*1-Min/gi, '')
      .replace(/\s*5-Min/gi, '')
      .replace(/\s*Chart\s*Analysis\s*/gi, '')
      .replace(/\s*Analysis\s*/gi, '')
      .trim();
  };

  const getMarketType = (result: AnalysisResult): 'REAL' | 'OTC' => {
    if (result.marketType === 'OTC' || result.marketType === 'REAL') {
      return result.marketType;
    }
    const title = result.analysisTitle?.toUpperCase() || '';
    return title.includes('OTC') ? 'OTC' : 'REAL';
  };

  const getMarketTypeStyle = (marketType: 'REAL' | 'OTC') => {
    if (marketType === 'OTC') {
      return 'border-white/40 text-white bg-white/[0.06]';
    }
    return 'border-emerald-400/40 text-emerald-300 bg-emerald-500/10';
  };

  const getRecommendationStyle = (rec: string) => {
    const upper = rec?.toUpperCase() || '';
    if (upper.includes('STRONG BUY')) return 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.3)] font-black';
    if (upper.includes('BUY')) return 'bg-green-500/25 border-green-500/40 text-green-300 shadow-[0_0_20px_rgba(34,197,94,0.3)] font-black';
    if (upper.includes('STRONG SELL')) return 'bg-rose-500/25 border-rose-500/45 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.3)] font-black';
    if (upper.includes('SELL')) return 'bg-rose-500/20 border-rose-500/40 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.25)] font-black';
    return 'bg-amber-500/20 border-amber-500/40 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.25)] font-black';
  };

  const isShowingReport = analysisResult || isAnalyzing;

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {/* Scrollable Area */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-6 pb-4 overscroll-contain">

        <AnimatePresence mode="wait">
          {!isShowingReport ? (
            /* ================= VIEW 1: HOME SCREEN (WITHOUT SIGNALS) ================= */
            <motion.div
              key="home-main"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.3 }}
              className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-10 xl:gap-12 lg:items-start lg:pt-6 xl:pt-8"
            >
              {/* Header — mobile/tablet only */}
              <div className="lg:hidden flex items-center justify-between px-4 h-16 rounded-xl bg-black/10 backdrop-blur-2xl border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.02)] select-none lg:col-span-2 max-lg:mt-1">
                {/* Grid dots icon container matching bottom icon background style */}
                <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)] flex items-center justify-center cursor-pointer hover:bg-white/[0.08] hover:scale-105 transition duration-200">
                  <div className="grid grid-cols-2 gap-1.5 w-4.5 h-4.5 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
                  </div>
                </div>

                {/* Bot name in uppercase white letters */}
                <div className="flex-1 flex justify-center">
                  <span className="text-[14px] font-black tracking-[0.25em] text-white select-none drop-shadow-[0_0_10px_rgba(255,255,255,0.45)]">
                    NEXUS AI
                  </span>
                </div>

                {/* Profile Avatar with matching glass container style */}
                <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)] flex items-center justify-center cursor-pointer hover:bg-white/[0.08] hover:scale-105 transition duration-200 p-1">
                  <NexusLogoAvatar size="xs" />
                </div>
              </div>

              <div className="space-y-6 lg:space-y-8">
              {/* Hello Welcoming — mobile only; desktop uses App header */}
              <div className="space-y-1 lg:hidden">
                <motion.h1
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="text-[28px] font-extrabold tracking-tight text-white leading-tight"
                >
                  Hello Everyone
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.5 }}
                  className="text-[13px] text-white/50 font-medium"
                >
                  Welcome Back!
                </motion.p>
              </div>

              {/* Upload Zone */}
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="relative p-6 rounded-xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.07] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06),0_15px_30px_-5px_rgba(0,0,0,0.45)] space-y-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-2 min-w-0">
                    <Sparkles className="w-5 h-5 text-amber-400 animate-pulse shrink-0" />
                    <span className="text-[14px] font-extrabold tracking-wide text-white truncate">AI Market Chart Analyzer</span>
                  </div>
                  {marketFeedReady === false && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/25">
                      Feed offline
                    </span>
                  )}
                  {marketFeedReady === true && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                      Feed live
                    </span>
                  )}
                </div>

                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative h-36 lg:h-64 xl:h-72 border border-dashed rounded-lg flex flex-col items-center justify-center space-y-3 cursor-pointer transition-all duration-300 ${
                    isDragOver 
                      ? 'border-amber-400/80 bg-amber-400/[0.03] shadow-[0_0_20px_rgba(234,179,8,0.2)]' 
                      : 'border-white/10 bg-white/[0.01] hover:border-white/20 hover:bg-white/[0.02]'
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    className="hidden"
                  />
                  <UploadCloud className={`w-9 h-9 transition-all duration-300 ${isDragOver ? 'text-amber-400' : 'text-white/40'}`} />
                  <div className="text-center">
                    <span className="text-[12px] font-bold text-white block">Drop trading screenshot here</span>
                    <span className="text-[10px] text-white/40 block mt-1">Drag & drop, click, or Ctrl+V / Cmd+V paste</span>
                  </div>
                </div>

                {/* Error message */}
                {error && (
                  <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start space-x-2.5 mt-2">
                    <Info className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="flex-1 text-[11px] text-rose-300 font-medium leading-normal">
                      {error}
                    </div>
                    <button onClick={() => setError(null)} className="text-rose-400/60 hover:text-rose-400 p-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </motion.div>
              </div>

              {/* Right column — info & tips on desktop */}
              <div className="space-y-6 lg:space-y-8 lg:pt-2">
              {/* Informational card to explain the analyzer */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="p-5 lg:p-8 rounded-xl lg:rounded-xl bg-white/[0.01] border border-white/[0.05] flex items-start space-x-3 lg:space-x-4"
              >
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] text-amber-400 shrink-0">
                  <Compass className="w-5 h-5 stroke-[1.5]" />
                </div>
                <div className="space-y-1">
                  <span className="text-[12px] font-bold text-white/90 block">Instant Automated Reports</span>
                  <p className="text-[11px] text-white/40 leading-relaxed">
                    Drop any candlestick chart, MT4/MT5 layout, or indicator screen. AI extracts support zones, trend probability, and signal confidence in seconds.
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="hidden lg:block p-6 xl:p-8 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-4"
              >
                <span className="text-[13px] font-bold text-white/80 block">Quick Tips</span>
                <ul className="space-y-3 text-[12px] text-white/45 leading-relaxed">
                  <li className="flex gap-2"><span className="text-amber-400">✦</span> Paste chart with Ctrl+V from anywhere in the app</li>
                  <li className="flex gap-2"><span className="text-amber-400">✦</span> Supports MT4, MT5, Quotex & indicator screenshots</li>
                  <li className="flex gap-2"><span className="text-amber-400">✦</span> AI fusion uses live market data + Gemini analysis</li>
                </ul>
              </motion.div>
              </div>
            </motion.div>
          ) : (
            /* ================= VIEW 2: DEDICATED ANALYSIS SCREEN ================= */
            <motion.div
              key="analysis-report"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.35 }}
              className="space-y-6 lg:max-w-4xl lg:mx-auto lg:w-full"
            >
              {/* Header — mobile/tablet only */}
              <div className="lg:hidden flex items-center justify-between px-4 h-16 rounded-xl bg-black/10 backdrop-blur-2xl border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.02)] select-none max-lg:mt-1">
                {/* Grid dots / Back icon container - acts as clear/back when clicked */}
                <button
                  onClick={handleClear}
                  disabled={isAnalyzing}
                  className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)] flex items-center justify-center cursor-pointer hover:bg-white/[0.08] hover:scale-105 transition duration-200 disabled:opacity-50 disabled:scale-100 disabled:hover:bg-white/[0.04]"
                >
                  <div className="grid grid-cols-2 gap-1.5 w-4.5 h-4.5 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/70 group-hover:bg-white transition-all duration-200" />
                  </div>
                </button>

                {/* Bot name in uppercase white letters */}
                <div className="flex-1 flex justify-center">
                  <span className="text-[14px] font-black tracking-[0.25em] text-white select-none drop-shadow-[0_0_10px_rgba(255,255,255,0.45)]">
                    NEXUS AI
                  </span>
                </div>

                {/* Profile Avatar with matching glass container style */}
                <div className="w-10 h-10 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-[0_0_12px_rgba(255,255,255,0.05)] flex items-center justify-center cursor-pointer hover:bg-white/[0.08] hover:scale-105 transition duration-200 p-1">
                  <NexusLogoAvatar size="xs" />
                </div>
              </div>

              {isAnalyzing && <AnalysisLoader progress={analysisProgress} />}

              {/* Analysis Result display */}
              {analysisResult && !isAnalyzing && (
                <div className="space-y-6">
                  {/* Premium Asset Signal Banner with integrated Recommendation */}
                  <div className="relative p-5 lg:p-8 rounded-lg bg-white/[0.04] border border-white/[0.08] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_12px_24px_-4px_rgba(0,0,0,0.4)] overflow-hidden">
                    {/* Ambient subtle top border highlight */}
                    <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                    
                    <div className="flex items-center justify-between gap-4 relative z-10 lg:flex-col lg:items-center lg:justify-center lg:text-center lg:gap-5">
                      <div className="space-y-1 lg:flex lg:flex-col lg:items-center">
                        <span className="text-[10px] text-white/40 tracking-widest font-mono block">SIGNAL DETECTED</span>
                        <div className="flex items-center gap-2.5 flex-wrap lg:justify-center">
                          <h2 className="text-[20px] lg:text-[24px] font-extrabold text-white tracking-tight leading-none">
                            {getCleanTitle(analysisResult.analysisTitle)}
                          </h2>
                          <span
                            className={`px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-[0.2em] uppercase select-none ${getMarketTypeStyle(getMarketType(analysisResult))}`}
                          >
                            {getMarketType(analysisResult)}
                          </span>
                        </div>
                      </div>
                      
                      {/* Premium recommendation badge with neon glow */}
                      <div className={`px-4 py-2 lg:px-6 lg:py-2.5 rounded-xl text-[12px] lg:text-[13px] font-extrabold uppercase tracking-wider border shadow-md select-none transition-all duration-300 ${getRecommendationStyle(analysisResult.recommendation)}`}>
                        {analysisResult.recommendation}
                      </div>
                    </div>
                  </div>

                  {/* ==================== SCREENSHOT HIGHLIGHTED CONVENTIONAL METRICS ==================== */}
                  <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0">
                    <div className="flex items-center space-x-2 pb-1 lg:col-span-2 lg:justify-center">
                      <BarChart2 className="w-4 h-4 text-white/60" />
                      <span className="text-[12px] font-bold text-white/60">Automated Signal Parameters</span>
                    </div>

                    {/* KPI 1: Market Confidence */}
                    <motion.div
                      whileHover={{ y: -3 }}
                      className="flex items-center justify-between p-4 rounded-lg bg-white/[0.03] border border-white/[0.06] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all duration-300"
                    >
                      <div className="space-y-0.5">
                        <span className="text-[13px] font-bold text-white/90 block">
                          {kpiData.confidence.title}
                        </span>
                        <span className="text-[10px] text-white/40 block font-medium">
                          {kpiData.confidence.desc}
                        </span>
                        <span className="text-[19px] font-extrabold text-green-400 tracking-tight block pt-1 font-sans">
                          {kpiData.confidence.val}
                        </span>
                      </div>
                      <ProgressArc percentage={kpiData.confidence.pct} color={kpiData.confidence.color} trend={kpiData.confidence.trend} />
                    </motion.div>

                    {/* KPI 2: Key Support Level */}
                    <motion.div
                      whileHover={{ y: -3 }}
                      className="flex items-center justify-between p-4 rounded-lg bg-white/[0.03] border border-white/[0.06] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all duration-300"
                    >
                      <div className="space-y-0.5">
                        <span className="text-[13px] font-bold text-white/90 block">
                          {kpiData.support.title}
                        </span>
                        <span className="text-[10px] text-white/40 block font-medium">
                          {kpiData.support.desc}
                        </span>
                        <span className="text-[19px] font-extrabold text-[#3b82f6] tracking-tight block pt-1 font-sans">
                          {kpiData.support.val}
                        </span>
                      </div>
                      <ProgressArc percentage={kpiData.support.pct} color={kpiData.support.color} trend={kpiData.support.trend} />
                    </motion.div>

                    {/* KPI 3: Key Resistance Level */}
                    <motion.div
                      whileHover={{ y: -3 }}
                      className="flex items-center justify-between p-4 rounded-lg bg-white/[0.03] border border-white/[0.06] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all duration-300"
                    >
                      <div className="space-y-0.5">
                        <span className="text-[13px] font-bold text-white/90 block">
                          {kpiData.resistance.title}
                        </span>
                        <span className="text-[10px] text-white/40 block font-medium">
                          {kpiData.resistance.desc}
                        </span>
                        <span className="text-[19px] font-extrabold text-amber-400 tracking-tight block pt-1 font-sans">
                          {kpiData.resistance.val}
                        </span>
                      </div>
                      <ProgressArc percentage={kpiData.resistance.pct} color={kpiData.resistance.color} trend={kpiData.resistance.trend} />
                    </motion.div>

                    {/* KPI 4: Signal Quality */}
                    <motion.div
                      whileHover={{ y: -3 }}
                      className="flex items-center justify-between p-4 rounded-lg bg-white/[0.03] border border-white/[0.06] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] transition-all duration-300"
                    >
                      <div className="space-y-0.5">
                        <span className="text-[13px] font-bold text-white/90 block">
                          {kpiData.quality.title}
                        </span>
                        <span className="text-[10px] text-white/40 block font-medium">
                          {kpiData.quality.desc}
                        </span>
                        <span className="text-[19px] font-extrabold text-green-400 tracking-tight block pt-1 font-sans">
                          {kpiData.quality.val}
                        </span>

                        <div className="pt-1.5">
                          <div className="flex items-center space-x-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 text-[9px] font-extrabold px-2.5 py-0.5 rounded-full w-max shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                            <span>{analysisResult.trend}</span>
                          </div>
                        </div>
                      </div>
                      <ProgressArc percentage={kpiData.quality.pct} color={kpiData.quality.color} trend={kpiData.quality.trend} />
                    </motion.div>
                  </div>

                  {/* ==================== COLLAPSIBLE ANALYSIS REPORT ==================== */}
                  <button
                    type="button"
                    onClick={() => setAnalysisExpanded((prev) => !prev)}
                    className="w-full text-left p-5 rounded-xl bg-white/[0.02] border border-white/[0.05] space-y-3 shadow-inner hover:border-white/[0.1] transition-colors duration-200"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span className="text-[12px] font-extrabold tracking-wide text-white uppercase">
                          Professional Analysis Details
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-white/40">
                        <span className="text-[9px] font-semibold tracking-wide uppercase">
                          {analysisExpanded ? 'Show Less' : 'Show More'}
                        </span>
                        {analysisExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-3">
                      {analysisExpanded ? (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.2 }}
                          className="space-y-1.5 overflow-x-hidden text-[12px] text-white/80 leading-relaxed font-normal"
                        >
                          {parseAndRenderMarkdown(analysisResult.analysisText)}
                        </motion.div>
                      ) : (
                        <div className="relative">
                          <p className="text-[12px] text-white/55 leading-relaxed line-clamp-2">
                            {getAnalysisPreview(analysisResult.analysisText)}
                          </p>
                          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[#0d0f12]/90 to-transparent pointer-events-none" />
                          <span className="block mt-2 text-[10px] text-amber-400/70 font-medium">
                            Tap to read full analysis
                          </span>
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Clean Bottom Trigger */}
                  <div className="pt-2">
                    <button
                      onClick={handleClear}
                      className="w-full py-3.5 border border-white/10 hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.04] text-white text-[12px] font-extrabold tracking-wider uppercase rounded-xl transition-all duration-200"
                    >
                      Analyze Signal
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      <AnimatePresence>
        {pasteHint && (
          <motion.div
            key="paste-hint"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute bottom-28 lg:bottom-8 left-1/2 -translate-x-1/2 z-50"
          >
            <span className="text-[10px] font-semibold text-emerald-300/95 tracking-wide whitespace-nowrap">
              Image pasted — analyzing...
            </span>
          </motion.div>
        )}
        {connectionToast && (
          <motion.div
            key={connectionToast}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute bottom-20 lg:bottom-8 left-1/2 -translate-x-1/2 z-50"
          >
            <span className="text-[10px] font-semibold text-rose-300/95 tracking-wide whitespace-nowrap">
              {connectionToast}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
