import { useState } from "react";
import { motion } from "motion/react";
import { Search, Copy, Check, Ban, Unlock, Trash2, Filter, RotateCcw, Pencil } from "lucide-react";
import type { License, LicenseTier } from "../types";
import { DEVICE_LIMIT_OPTIONS } from "../types";
import { TIER_CONFIG } from "../lib/tiers";
import EditLicenseModal from "./EditLicenseModal";

function formatDailyLimit(limit: number): string {
  return limit < 0 ? "Unlimited" : String(limit);
}

function formatDeviceLimit(limit: number): string {
  return DEVICE_LIMIT_OPTIONS.find((o) => o.value === limit)?.label ?? String(limit);
}

function getBindingsCount(lic: License): number {
  return lic.deviceBindings?.length ?? (lic.deviceBinding?.fingerprint ? 1 : 0);
}

interface LicenseListProps {
  licenses: License[];
  onBlock: (id: string) => void;
  onUnblock: (id: string) => void;
  onDelete: (id: string) => void;
  onResetDevice: (id: string) => void;
  onEdit: (
    id: string,
    patch: {
      tier: LicenseTier;
      holderTelegram: string;
      dailyLimit: number;
      deviceLimit: number;
      note: string;
      status: "active" | "blocked";
    }
  ) => Promise<void>;
}

export default function LicenseList({
  licenses,
  onBlock,
  onUnblock,
  onDelete,
  onResetDevice,
  onEdit,
}: LicenseListProps) {
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState<LicenseTier | "all">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "blocked">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingLicense, setEditingLicense] = useState<License | null>(null);

  const filtered = licenses.filter((lic) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      lic.key.toLowerCase().includes(q) ||
      lic.holderName.toLowerCase().includes(q) ||
      lic.holderTelegram.toLowerCase().includes(q);
    const matchTier = filterTier === "all" || lic.tier === filterTier;
    const matchStatus = filterStatus === "all" || lic.status === filterStatus;
    return matchSearch && matchTier && matchStatus;
  });

  const copyKey = async (id: string, key: string) => {
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
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = (lic: License) => {
    const ok = window.confirm(
      `Delete user "${lic.holderName}" and license ${lic.key}?\nThis cannot be undone.`
    );
    if (ok) onDelete(lic.id);
  };

  const handleResetDevice = (lic: License) => {
    const ok = window.confirm(
      `Reset device binding for "${lic.holderName}"?\nThey can activate on a new device after reset.`
    );
    if (ok) onResetDevice(lic.id);
  };

  return (
    <div className="space-y-6 w-full max-w-none">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl lg:text-3xl font-black text-white tracking-tight">Users & Licenses</h1>
        <p className="text-[13px] text-white/45 mt-1">
          {licenses.length} users · Edit, block, or delete anytime
        </p>
      </motion.div>

      <div className="flex flex-col xl:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search username, telegram, license key..."
            className="w-full pl-10 pr-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder:text-white/25 focus:outline-none focus:border-amber-500/30"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-white/30 shrink-0 hidden sm:block" />
          {(["all", "basic", "pro", "premium", "regular"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterTier(t)}
              className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase border transition-all ${
                filterTier === t
                  ? "bg-white/10 border-white/20 text-white"
                  : "border-white/[0.06] text-white/40"
              }`}
            >
              {t === "all" ? "All Plans" : TIER_CONFIG[t].label}
            </button>
          ))}
          {(["all", "active", "blocked"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase border transition-all ${
                filterStatus === s
                  ? s === "blocked"
                    ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                    : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                  : "border-white/[0.06] text-white/40"
              }`}
            >
              {s === "all" ? "All Status" : s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-1">
        {filtered.length === 0 ? (
          <div className="col-span-full p-12 text-center rounded-2xl border border-dashed border-white/[0.08] text-white/40 text-[13px]">
            No users found. Create a license from the Create tab.
          </div>
        ) : (
          filtered.map((lic, i) => (
            <motion.div
              key={lic.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
              className={`p-4 sm:p-5 rounded-2xl border backdrop-blur-xl ${
                lic.status === "active"
                  ? "bg-white/[0.03] border-white/[0.07]"
                  : "bg-rose-500/[0.05] border-rose-500/25"
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-2 min-w-0 flex-1 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                  <InfoCell label="Username" value={lic.holderTelegram || lic.holderName || "—"} />
                  <InfoCell label="License" value={lic.key} mono accent />
                  <InfoCell label="Plan" value={TIER_CONFIG[lic.tier].label} />
                  <InfoCell label="Signals/Day" value={formatDailyLimit(lic.dailyLimit)} />
                  <InfoCell
                    label="Devices"
                    value={`${getBindingsCount(lic)} / ${formatDeviceLimit(lic.deviceLimit ?? 1)}`}
                  />
                  <InfoCell
                    label="Status"
                    value={lic.status === "active" ? "Active" : "Blocked"}
                    danger={lic.status === "blocked"}
                  />
                  <InfoCell
                    label="Created"
                    value={new Date(lic.createdAt).toLocaleDateString()}
                  />
                  <InfoCell
                    label="Device"
                    value={
                      getBindingsCount(lic) > 0
                        ? `${getBindingsCount(lic)} bound`
                        : "Not bound yet"
                    }
                    accent={getBindingsCount(lic) > 0}
                  />
                  {getBindingsCount(lic) > 0 && lic.deviceBindings?.[0] && (
                    <InfoCell
                      label="Last IP"
                      value={lic.deviceBindings[lic.deviceBindings.length - 1].ip}
                    />
                  )}
                  {lic.deviceBinding?.fingerprint && !lic.deviceBindings?.length && (
                    <InfoCell
                      label="Fingerprint"
                      value={`${lic.deviceBinding.fingerprint.slice(0, 12)}…`}
                      mono
                    />
                  )}
                </div>

                <div className="flex flex-wrap gap-2 shrink-0">
                  <ActionBtn
                    onClick={() => setEditingLicense(lic)}
                    label="Edit"
                    icon={Pencil}
                    variant="neutral"
                  />
                  {getBindingsCount(lic) > 0 && (
                    <ActionBtn
                      onClick={() => handleResetDevice(lic)}
                      label="Reset Device"
                      icon={RotateCcw}
                      variant="neutral"
                    />
                  )}
                  <ActionBtn
                    onClick={() => copyKey(lic.id, lic.key)}
                    label={copiedId === lic.id ? "Copied" : "Copy"}
                    icon={copiedId === lic.id ? Check : Copy}
                    variant="neutral"
                  />
                  {lic.status === "active" ? (
                    <ActionBtn
                      onClick={() => onBlock(lic.id)}
                      label="Block"
                      icon={Ban}
                      variant="danger"
                    />
                  ) : (
                    <ActionBtn
                      onClick={() => onUnblock(lic.id)}
                      label="Unblock"
                      icon={Unlock}
                      variant="success"
                    />
                  )}
                  <ActionBtn
                    onClick={() => handleDelete(lic)}
                    label="Delete"
                    icon={Trash2}
                    variant="danger"
                  />
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {editingLicense && (
        <EditLicenseModal
          license={editingLicense}
          onClose={() => setEditingLicense(null)}
          onSave={onEdit}
        />
      )}
    </div>
  );
}

function InfoCell({
  label,
  value,
  mono,
  accent,
  danger,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold text-white/35 uppercase tracking-wider">{label}</p>
      <p
        className={`text-[12px] font-semibold truncate mt-0.5 ${
          danger ? "text-rose-300" : accent ? "text-amber-300/90" : "text-white/85"
        } ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function ActionBtn({
  onClick,
  label,
  icon: Icon,
  variant,
}: {
  onClick: () => void;
  label: string;
  icon: typeof Copy;
  variant: "neutral" | "danger" | "success";
}) {
  const styles = {
    neutral: "bg-white/[0.05] border-white/[0.08] text-white/70",
    danger: "bg-rose-500/10 border-rose-500/25 text-rose-300",
    success: "bg-emerald-500/10 border-emerald-500/25 text-emerald-300",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase transition-all hover:scale-[1.02] active:scale-[0.98] ${styles[variant]}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
