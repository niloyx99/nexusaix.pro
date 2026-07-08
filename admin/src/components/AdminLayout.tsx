import { motion } from "motion/react";
import {
  LayoutDashboard,
  KeyRound,
  PlusCircle,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import type { AdminView } from "../types";

interface AdminLayoutProps {
  view: AdminView;
  onViewChange: (view: AdminView) => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onMobileToggle: () => void;
  children: React.ReactNode;
}

const NAV: { id: AdminView; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "licenses", label: "Licenses", icon: KeyRound },
  { id: "create", label: "Create", icon: PlusCircle },
];

export default function AdminLayout({
  view,
  onViewChange,
  onLogout,
  mobileOpen,
  onMobileToggle,
  children,
}: AdminLayoutProps) {
  const NavButtons = ({ onPick }: { onPick?: () => void }) => (
    <>
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onViewChange(item.id);
              onPick?.();
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200 ${
              active
                ? "bg-white/[0.08] border border-white/[0.12] text-white shadow-lg"
                : "text-white/45 hover:text-white/80 hover:bg-white/[0.03] border border-transparent"
            }`}
          >
            <Icon className={`w-4 h-4 ${active ? "text-amber-400" : ""}`} />
            <span className="text-[12px] font-bold tracking-wide">{item.label}</span>
          </button>
        );
      })}
    </>
  );

  return (
    <div className="h-full flex flex-col lg:flex-row min-h-0">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-72 xl:w-80 lg:flex-col lg:shrink-0 p-6 border-r border-white/[0.06] bg-black/25 backdrop-blur-xl">
        <div className="mb-8 px-2">
          <p className="text-[10px] text-white/35 uppercase tracking-[0.25em] font-bold">Control</p>
          <h2 className="text-lg font-black text-white tracking-wider mt-1">NEXUS AI</h2>
          <p className="text-[10px] text-amber-400/80 font-semibold mt-0.5">Admin Panel</p>
        </div>
        <nav className="flex-1 space-y-2">
          <NavButtons />
        </nav>
        <button
          type="button"
          onClick={onLogout}
          className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl text-rose-300/80 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition-all w-full"
        >
          <LogOut className="w-4 h-4" />
          <span className="text-[12px] font-bold">Logout</span>
        </button>
      </aside>

      {/* Mobile header */}
      <header className="lg:hidden flex items-center justify-between px-4 h-14 shrink-0 border-b border-white/[0.06] bg-black/30 backdrop-blur-xl">
        <div>
          <p className="text-[12px] font-black text-white tracking-widest">NEXUS AI Admin</p>
        </div>
        <button
          type="button"
          onClick={onMobileToggle}
          className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center"
        >
          {mobileOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={onMobileToggle}
        >
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            className="w-[260px] h-full bg-[#0d0f12]/95 border-r border-white/[0.08] p-5 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] text-white/35 uppercase tracking-widest font-bold mb-6">Menu</p>
            <nav className="flex-1 space-y-2">
              <NavButtons onPick={onMobileToggle} />
            </nav>
            <button
              type="button"
              onClick={() => {
                onLogout();
                onMobileToggle();
              }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-rose-300 border border-rose-500/20"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-[12px] font-bold">Logout</span>
            </button>
          </motion.aside>
        </motion.div>
      )}

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:p-8 xl:px-12 xl:py-10">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden shrink-0 flex items-center justify-around px-2 py-2 border-t border-white/[0.06] bg-black/30 backdrop-blur-xl safe-bottom">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${
                active ? "text-amber-400" : "text-white/35"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[9px] font-bold uppercase">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
