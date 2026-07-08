import { useState, useEffect, useCallback } from "react";

import { AnimatePresence, motion } from "motion/react";

import GlowBackground from "./components/GlowBackground";

import AdminLogin from "./components/AdminLogin";

import AdminLayout from "./components/AdminLayout";

import Dashboard from "./components/Dashboard";

import CreateLicense from "./components/CreateLicense";

import LicenseList from "./components/LicenseList";

import type { AdminView, License } from "./types";

import { adminLogout, isAdminLoggedIn } from "./lib/storage";

import {

  createLicenseApi,

  deleteLicenseApi,

  fetchLicenses,

  migrateLegacyLicensesIfNeeded,

  resetLicenseDeviceApi,

  updateLicenseApi,

  updateLicenseStatusApi,

} from "./lib/api";



export default function App() {

  const [authed, setAuthed] = useState(isAdminLoggedIn);

  const [view, setView] = useState<AdminView>("dashboard");

  const [licenses, setLicenses] = useState<License[]>([]);

  const [mobileOpen, setMobileOpen] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);



  const refreshLicenses = useCallback(async () => {

    setLoading(true);

    setError(null);

    try {

      await migrateLegacyLicensesIfNeeded();

      const data = await fetchLicenses();

      setLicenses(data);

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to load licenses.");

    } finally {

      setLoading(false);

    }

  }, []);



  useEffect(() => {

    if (!authed) return;

    void refreshLicenses();

  }, [authed, refreshLicenses]);



  const handleCreated = async (license: License) => {

    try {

      setError(null);

      const created = await createLicenseApi(license);

      setLicenses((prev) => [created, ...prev]);

      setView("licenses");

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to create license.");

    }

  };



  const handleBlock = async (id: string) => {

    try {

      const updated = await updateLicenseStatusApi(id, "blocked");

      setLicenses((prev) => prev.map((l) => (l.id === id ? updated : l)));

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to block license.");

    }

  };



  const handleUnblock = async (id: string) => {

    try {

      const updated = await updateLicenseStatusApi(id, "active");

      setLicenses((prev) => prev.map((l) => (l.id === id ? updated : l)));

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to unblock license.");

    }

  };



  const handleDelete = async (id: string) => {

    try {

      await deleteLicenseApi(id);

      setLicenses((prev) => prev.filter((l) => l.id !== id));

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to delete license.");

    }

  };



  const handleResetDevice = async (id: string) => {

    try {

      const updated = await resetLicenseDeviceApi(id);

      setLicenses((prev) => prev.map((l) => (l.id === id ? updated : l)));

    } catch (err) {

      setError(err instanceof Error ? err.message : "Failed to reset device.");

    }

  };



  const handleEditLicense = async (
    id: string,
    patch: {
      tier: License["tier"];
      holderTelegram: string;
      dailyLimit: number;
      deviceLimit: number;
      note: string;
      status: "active" | "blocked";
    }
  ) => {
    try {
      setError(null);
      const updated = await updateLicenseApi(id, patch);
      setLicenses((prev) => prev.map((l) => (l.id === id ? updated : l)));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update license.";
      setError(message);
      throw err;
    }
  };



  const handleLogout = () => {

    adminLogout();

    setAuthed(false);

    setLicenses([]);

  };



  return (

    <div className="relative h-[100dvh] max-h-[100dvh] w-full font-sans antialiased overflow-hidden">

      <GlowBackground />



      <div className="relative h-full w-full bg-[#0d0f12]/75 backdrop-blur-[35px] overflow-hidden flex flex-col lg:rounded-none">

        <AnimatePresence mode="wait">

          {!authed ? (

            <motion.div

              key="login"

              initial={{ opacity: 0 }}

              animate={{ opacity: 1 }}

              exit={{ opacity: 0 }}

              className="flex-1 flex items-center justify-center p-6 overflow-y-auto"

            >

              <AdminLogin onSuccess={() => setAuthed(true)} />

            </motion.div>

          ) : (

            <motion.div

              key="panel"

              initial={{ opacity: 0 }}

              animate={{ opacity: 1 }}

              className="flex-1 min-h-0 flex flex-col"

            >

              {error && (

                <div className="mx-4 mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-[12px] font-medium shrink-0">

                  {error}

                  <button

                    type="button"

                    className="ml-3 underline"

                    onClick={() => void refreshLicenses()}

                  >

                    Retry

                  </button>

                </div>

              )}

              <AdminLayout

                view={view}

                onViewChange={setView}

                onLogout={handleLogout}

                mobileOpen={mobileOpen}

                onMobileToggle={() => setMobileOpen((o) => !o)}

              >

                {loading && licenses.length === 0 ? (

                  <div className="text-white/50 text-sm p-8">Loading licenses...</div>

                ) : (

                  <>

                    {view === "dashboard" && <Dashboard licenses={licenses} />}

                    {view === "licenses" && (

                      <LicenseList

                        licenses={licenses}

                        onBlock={handleBlock}

                        onUnblock={handleUnblock}

                        onDelete={handleDelete}

                        onResetDevice={handleResetDevice}

                        onEdit={handleEditLicense}

                      />

                    )}

                    {view === "create" && <CreateLicense onCreated={handleCreated} />}

                  </>

                )}

              </AdminLayout>

            </motion.div>

          )}

        </AnimatePresence>

      </div>

    </div>

  );

}


