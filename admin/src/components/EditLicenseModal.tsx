import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Save, AlertCircle, KeyRound } from "lucide-react";
import type { License, LicenseTier, SignalLimitMode } from "../types";
import { DEVICE_LIMIT_OPTIONS, UNLIMITED_DAILY_LIMIT } from "../types";
import { TIER_CONFIG, getDailyLimit } from "../lib/tiers";

interface EditLicenseModalProps {
  license: License;
  onClose: () => void;
  onSave: (id: string, patch: {
    tier: LicenseTier;
    holderTelegram: string;
    dailyLimit: number;
    deviceLimit: number;
    note: string;
    status: "active" | "blocked";
  }) => Promise<void>;
}

function inferSignalLimitMode(license: License): SignalLimitMode {
  if (license.tier === "regular" && license.dailyLimit < 0) return "tier";
  if (license.dailyLimit < 0) return "unlimited";
  if (license.dailyLimit === getDailyLimit(license.tier)) return "tier";
  return "custom";
}

export default function EditLicenseModal({ license, onClose, onSave }: EditLicenseModalProps) {
  const [tier, setTier] = useState<LicenseTier>(license.tier);
  const [username, setUsername] = useState(
    license.holderTelegram.replace(/^@/, "") || license.holderName
  );
  const [signalLimitMode, setSignalLimitMode] = useState<SignalLimitMode>(
    inferSignalLimitMode(license)
  );
  const [customDailyLimit, setCustomDailyLimit] = useState(
    String(license.dailyLimit > 0 ? license.dailyLimit : getDailyLimit(license.tier))
  );
  const [deviceLimit, setDeviceLimit] = useState(license.deviceLimit ?? 1);
  const [note, setNote] = useState(license.note ?? "");
  const [status, setStatus] = useState<"active" | "blocked">(license.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveDailyLimit = (): number => {
    if (signalLimitMode === "unlimited") return UNLIMITED_DAILY_LIMIT;
    if (signalLimitMode === "custom") {
      const n = Number(customDailyLimit);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : getDailyLimit(tier);
    }
    return getDailyLimit(tier);
  };

  const handleSubmit = async (e: React.FormEvent) => {
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

    setSaving(true);
    try {
      await onSave(license.id, {
        tier,
        holderTelegram: `@${trimmedUser}`,
        dailyLimit,
        deviceLimit,
        note,
        status,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update license.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-[28px] bg-[#12151a] border border-white/[0.1] shadow-2xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">Edit License</h2>
              <p className="text-[11px] text-white/45 mt-1 font-mono">{license.key}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/60 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                License Plan
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(Object.keys(TIER_CONFIG) as LicenseTier[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTier(t);
                      if (t === "regular") setSignalLimitMode("tier");
                    }}
                    className={`py-2.5 rounded-xl border text-[10px] font-bold transition-all ${
                      tier === t
                        ? t === "regular"
                          ? "bg-violet-500/15 border-violet-500/40 text-violet-300"
                          : "bg-amber-500/15 border-amber-500/40 text-amber-300"
                        : "bg-white/[0.02] border-white/[0.06] text-white/45"
                    }`}
                  >
                    {TIER_CONFIG[t].label}
                  </button>
                ))}
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
                    className={`py-2 rounded-xl border text-[10px] font-bold uppercase transition-all ${
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

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@username"
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest flex items-center gap-1.5">
                <KeyRound className="w-3 h-3" />
                License Key (read-only)
              </label>
              <input
                readOnly
                value={license.key}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.08] text-amber-300/80 font-mono text-[12px]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                Status
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["active", "blocked"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`py-2.5 rounded-xl border text-[10px] font-bold uppercase transition-all ${
                      status === s
                        ? s === "blocked"
                          ? "bg-rose-500/15 border-rose-500/35 text-rose-300"
                          : "bg-emerald-500/15 border-emerald-500/35 text-emerald-300"
                        : "bg-white/[0.02] border-white/[0.06] text-white/45"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">
                Note (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px] resize-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[11px]">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white/70 text-[11px] font-bold uppercase"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-[11px] font-extrabold uppercase flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
