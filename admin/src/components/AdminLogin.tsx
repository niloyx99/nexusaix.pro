import { useState } from "react";
import { motion } from "motion/react";
import { Lock, Loader2, Shield, AlertCircle } from "lucide-react";
import { adminLogin } from "../lib/storage";
import { verifyAdminPassword } from "../lib/api";
import { getBackendUrl } from "../lib/backend";

interface AdminLoginProps {
  onSuccess: () => void;
}

export default function AdminLogin({ onSuccess }: AdminLoginProps) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const trimmed = password.trim();
    try {
      const ok = await verifyAdminPassword(trimmed);
      if (!ok) {
        setError("Invalid admin password or backend rejected login.");
        setPassword("");
        return;
      }
      adminLogin(trimmed);
      onSuccess();
    } catch {
      const backend = getBackendUrl();
      setError(
        backend
          ? `Cannot reach backend at ${backend}. Check Render is live and CORS allows this admin URL.`
          : "VITE_BACKEND_URL is missing — set it in Vercel env and redeploy."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-8 rounded-[32px] bg-white/[0.04] backdrop-blur-2xl border border-white/[0.08] shadow-2xl space-y-6"
      >
        <div className="text-center space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Shield className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-xl font-black tracking-[0.2em] text-white">NEXUS AI</h1>
          <p className="text-[12px] text-white/45 font-medium">Admin Panel — Secure Login</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest pl-1">
              Admin Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-[13px] placeholder:text-white/25 focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 transition-all"
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[11px] font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 disabled:opacity-40 text-white font-extrabold text-[12px] uppercase tracking-widest shadow-[0_8px_25px_-5px_rgba(245,158,11,0.35)] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying...
              </>
            ) : (
              "Login to Admin"
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
