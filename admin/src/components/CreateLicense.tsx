import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Copy, Check, Sparkles, User, KeyRound, AlertCircle } from "lucide-react";
import type { License, LicenseTier, SignalLimitMode } from "../types";
import { DEVICE_LIMIT_OPTIONS, UNLIMITED_DAILY_LIMIT } from "../types";
import { TIER_CONFIG, getDailyLimit, formatTierDailySignals } from "../lib/tiers";
import { generateLicenseKey } from "../lib/storage";

interface CreateLicenseProps {
  onCreated: (license: License) => void;
}

function formatDailyLimitLabel(limit: number): string {
  return limit < 0 ? "Unlimited" : `${limit} / day`;
}

export default function CreateLicense({ onCreated }: CreateLicenseProps) {
  const [tier, setTier] = useState<LicenseTier>("basic");
  const [username, setUsername] = useState("");
  const [previewKey, setPreviewKey] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdTier, setCreatedTier] = useState<LicenseTier>("basic");
  const [createdDailyLimit, setCreatedDailyLimit] = useState(12);
  const [createdDeviceLimit, setCreatedDeviceLimit] = useState(1);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signalLimitMode, setSignalLimitMode] = useState<SignalLimitMode>("tier");
  const [customDailyLimit, setCustomDailyLimit] = useState("30");
  const [deviceLimit, setDeviceLimit] = useState(1);

  useEffect(() => {
    setPreviewKey(generateLicenseKey());
  }, []);

  const resolveDailyLimit = (): number => {
    if (signalLimitMode === "unlimited") return UNLIMITED_DAILY_LIMIT;
    if (signalLimitMode === "custom") {
      const n = Number(customDailyLimit);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : getDailyLimit(tier);
    }
    return getDailyLimit(tier);
  };

  const handleTierChange = (t: LicenseTier) => {
    setTier(t);
    if (t === "regular") {
      setSignalLimitMode("tier");
    }
    setPreviewKey(generateLicenseKey());
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUser = username.trim().replace(/^@/, "");
    if (!trimmedUser) {
      setError("Username is required.");
      return;
    }

    const dailyLimit = resolveDailyLimit();
    if (signalLimitMode === "custom" && dailyLimit <= 0) {
      setError("Custom signal limit must be greater than 0.");
      return;
    }

    const key = previewKey || generateLicenseKey();
    const telegram = `@${trimmedUser}`;
    const license: License = {
      id: `lic-${Date.now()}`,
      key,
      tier,
      dailyLimit,
      deviceLimit,
      holderName: trimmedUser,
      holderEmail: "",
      holderTelegram: telegram,
      status: "active",
      createdAt: new Date().toISOString(),
      note: "",
    };

    onCreated(license);
    setCreatedKey(key);
    setCreatedTier(tier);
    setCreatedDailyLimit(dailyLimit);
    setCreatedDeviceLimit(deviceLimit);
    setUsername("");
    setPreviewKey(generateLicenseKey());
  };

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = key;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const summaryDailyLimit = resolveDailyLimit();
  const deviceLabel =
    DEVICE_LIMIT_OPTIONS.find((o) => o.value === deviceLimit)?.label ?? `${deviceLimit} Devices`;

  return (
    <div className="space-y-6 w-full max-w-none">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl lg:text-3xl font-black text-white tracking-tight">Create License</h1>
        <p className="text-[13px] text-white/45 mt-1">
          Set signal limit, device limit, username, and create
        </p>
      </motion.div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <form
          onSubmit={handleCreate}
          className="p-5 sm:p-7 rounded-[28px] bg-white/[0.03] border border-white/[0.07] space-y-5"
        >
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
              License Plan
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {(Object.keys(TIER_CONFIG) as LicenseTier[]).map((t) => {
                const cfg = TIER_CONFIG[t];
                const selected = tier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTierChange(t)}
                    className={`p-3 sm:p-4 rounded-xl border text-center transition-all ${
                      selected
                        ? t === "regular"
                          ? "bg-violet-500/15 border-violet-500/40 text-violet-300 shadow-[0_0_20px_rgba(139,92,246,0.15)]"
                          : "bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.12)]"
                        : "bg-white/[0.02] border-white/[0.06] text-white/50 hover:border-white/15"
                    }`}
                  >
                    <p className="text-[12px] sm:text-[13px] font-black">{cfg.label}</p>
                    <p className="text-[10px] mt-1 opacity-80">
                      {formatTierDailySignals(cfg.dailySignals)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
              Daily Signal Limit
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: "tier", label: "Plan Default" },
                  { id: "custom", label: "Custom" },
                  { id: "unlimited", label: "Regular ∞" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSignalLimitMode(opt.id)}
                  className={`py-2.5 px-2 rounded-xl border text-[10px] font-bold uppercase transition-all ${
                    signalLimitMode === opt.id
                      ? "bg-emerald-500/15 border-emerald-500/35 text-emerald-300"
                      : "bg-white/[0.02] border-white/[0.06] text-white/45"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {signalLimitMode === "custom" && (
              <input
                type="number"
                min={1}
                value={customDailyLimit}
                onChange={(e) => setCustomDailyLimit(e.target.value)}
                placeholder="Signals per day"
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px]"
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
              Device Limit
            </label>
            <div className="grid grid-cols-4 gap-2">
              {DEVICE_LIMIT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDeviceLimit(opt.value)}
                  className={`py-2 rounded-xl border text-[10px] font-bold transition-all ${
                    deviceLimit === opt.value
                      ? "bg-blue-500/15 border-blue-500/35 text-blue-300"
                      : "bg-white/[0.02] border-white/[0.06] text-white/45"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <Field
            label="Username"
            required
            icon={User}
            value={username}
            onChange={setUsername}
            placeholder="@username"
          />

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest flex items-center gap-1.5">
              <KeyRound className="w-3 h-3" />
              License Key (auto)
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={previewKey || "Auto-generated on create"}
                className="flex-1 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.08] text-amber-300/90 font-mono text-[12px]"
              />
              <button
                type="button"
                onClick={() => setPreviewKey(generateLicenseKey())}
                className="px-4 py-3 rounded-xl bg-white/[0.06] border border-white/[0.1] text-[10px] font-bold text-white/70 uppercase whitespace-nowrap"
              >
                Regenerate
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[11px]">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-extrabold text-[12px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4" />
            Create License
          </button>
        </form>

        <div className="space-y-4">
          <div className="p-5 sm:p-6 rounded-[28px] bg-white/[0.02] border border-white/[0.06] space-y-3">
            <h3 className="text-[13px] font-black text-white uppercase tracking-wide">User Summary</h3>
            <SummaryRow
              label="Username"
              value={username ? (username.startsWith("@") ? username : `@${username}`) : "—"}
            />
            <SummaryRow label="License Plan" value={TIER_CONFIG[tier].label} />
            <SummaryRow label="Daily Signals" value={formatDailyLimitLabel(summaryDailyLimit)} />
            <SummaryRow label="Device Limit" value={deviceLabel} />
          </div>

          <AnimatePresence>
            {createdKey && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="p-5 sm:p-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-3"
              >
                <div className="flex items-center gap-2 text-emerald-300">
                  <Sparkles className="w-4 h-4" />
                  <span className="text-[12px] font-black uppercase tracking-wide">License Created</span>
                </div>
                <p className="font-mono text-[14px] text-white break-all select-all">{createdKey}</p>
                <p className="text-[11px] text-white/45">
                  {TIER_CONFIG[createdTier].label} — {formatDailyLimitLabel(createdDailyLimit)} —{" "}
                  {DEVICE_LIMIT_OPTIONS.find((o) => o.value === createdDeviceLimit)?.label}
                </p>
                <button
                  type="button"
                  onClick={() => copyKey(createdKey)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/[0.08] border border-white/[0.1] text-[11px] font-bold text-white"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied!" : "Copy License Key"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-[12px] border-b border-white/[0.04] pb-2 last:border-0">
      <span className="text-white/40 font-medium">{label}</span>
      <span className="text-white/85 font-semibold text-right truncate">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  icon: Icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  required?: boolean;
  icon?: typeof User;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
        {label} {required && <span className="text-amber-400">*</span>}
      </label>
      <div className="relative">
        {Icon && <Icon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className={`w-full ${Icon ? "pl-11" : "pl-4"} pr-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder:text-white/25 focus:outline-none focus:border-amber-500/35 focus:ring-1 focus:ring-amber-500/15 transition-all`}
        />
      </div>
    </div>
  );
}
