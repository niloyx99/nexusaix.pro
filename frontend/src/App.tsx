import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import GlowBackground from './components/GlowBackground';
import DashboardScreenOne from './components/DashboardScreenOne';
import DashboardScreenTwo from './components/DashboardScreenTwo';
import SignalsScreen from './components/SignalsScreen';
import ProfileScreen from './components/ProfileScreen';
import BottomNavigation from './components/BottomNavigation';
import SideNavigation from './components/SideNavigation';
import LoginScreen from './components/LoginScreen';
import { TabType, NexusUser } from './types';
import {
  dispatchChartPaste,
  getImageFromClipboardEvent,
  isTypingTarget,
} from './utils/clipboardImage';
import NexusLogoAvatar from './components/NexusLogoAvatar';
import {
  clearNexusUser,
  loadNexusUser,
  refreshLicenseStatus,
  saveNexusUser,
} from './lib/nexusUser';
import { getDeviceFingerprint } from './lib/deviceFingerprint';

const DESKTOP_TITLES: Record<TabType, { title: string; subtitle: string }> = {
  home: { title: 'Hello Everyone', subtitle: 'Welcome Back!' },
  signals: { title: 'Live Signals', subtitle: 'AI-powered market signals' },
  stats: { title: 'Performance', subtitle: 'Accuracy & trading stats' },
  profile: { title: 'My Profile', subtitle: 'Account & license details' },
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [activatedUser, setActivatedUser] = useState<NexusUser | null>(() => loadNexusUser());
  const [sessionChecking, setSessionChecking] = useState(() => !!loadNexusUser());

  const handleActivate = (user: NexusUser) => {
    saveNexusUser(user);
    setActivatedUser(user);
    setSessionChecking(false);
  };

  useEffect(() => {
    const saved = loadNexusUser();
    if (!saved) {
      setSessionChecking(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setSessionChecking(false);
    }, 12_000);

    getDeviceFingerprint()
      .then((deviceFingerprint) =>
        refreshLicenseStatus(saved.licenseKey, deviceFingerprint).then((status) => ({
          status,
          deviceFingerprint,
        }))
      )
      .then(({ status, deviceFingerprint }) => {
        const updated: NexusUser = {
          ...saved,
          tier: status.tier,
          dailyLimit: status.dailyLimit,
          deviceLimit: status.deviceLimit,
          holderName: status.holderName,
          deviceFingerprint,
          usedToday: status.usage.usedToday,
          remaining: status.usage.remaining,
          totalScans: status.usage.totalScans,
          devicesUsed: status.devicesUsed,
          licenseCreatedAt: status.createdAt,
          validatedAt: new Date().toISOString(),
        };
        saveNexusUser(updated);
        setActivatedUser(updated);
      })
      .catch(() => {
        clearNexusUser();
        setActivatedUser(null);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        setSessionChecking(false);
      });
  }, []);

  useEffect(() => {
    if (!activatedUser) return;

    const handlePaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const imageFile = getImageFromClipboardEvent(event);
      if (!imageFile) return;

      event.preventDefault();
      if (activeTab !== 'home') {
        setActiveTab('home');
        window.setTimeout(() => dispatchChartPaste(imageFile), 80);
      } else {
        dispatchChartPaste(imageFile);
      }
      document.getElementById('dashboard-container')?.focus({ preventScroll: true });
    };

    window.addEventListener('paste', handlePaste, true);
    return () => window.removeEventListener('paste', handlePaste, true);
  }, [activatedUser, activeTab]);

  const desktopHeader = activatedUser ? DESKTOP_TITLES[activeTab] : null;

  return (
    <div className="relative w-full h-[100dvh] max-h-[100dvh] flex items-stretch justify-center font-sans overflow-hidden antialiased sm:py-6 lg:py-0">
      <GlowBackground />

      <div
        id="dashboard-container"
        tabIndex={-1}
        className="w-full h-full sm:h-[820px] sm:max-h-[90vh] sm:w-[410px] sm:rounded-[40px] lg:w-full lg:max-w-none lg:h-full lg:max-h-full lg:rounded-none bg-transparent backdrop-blur-[35px] relative shadow-2xl flex flex-col lg:flex-row overflow-hidden transition-all duration-500 border-0 sm:border lg:border-0 border-white/[0.06] outline-none"
      >
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none rounded-[inherit]">
          <div className="absolute inset-0 bg-[#0d0f12]/65" />
          <div className="absolute -top-[15%] -right-[15%] w-[90%] h-[65%] rounded-full bg-[#521320]/45 blur-[75px] sm:blur-[95px] opacity-95 animate-glow-1" />
          <div className="absolute -bottom-[15%] -left-[15%] w-[90%] h-[65%] rounded-full bg-[#0c351a]/45 blur-[75px] sm:blur-[95px] opacity-95 animate-glow-2" />
          <div className="absolute inset-0 bg-radial-at-t from-white/[0.02] via-transparent to-transparent opacity-60" />
        </div>

        {activatedUser && (
          <SideNavigation activeTab={activeTab} onChangeTab={setActiveTab} />
        )}

        <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
          {desktopHeader && (
            <header className="hidden lg:flex items-center justify-between px-10 xl:px-14 py-6 shrink-0 border-b border-white/[0.06]">
              <div>
                <h1 className="text-3xl font-extrabold tracking-tight text-white">{desktopHeader.title}</h1>
                <p className="text-[14px] text-white/45 font-medium mt-1">{desktopHeader.subtitle}</p>
              </div>
              <NexusLogoAvatar size="md" rounded="lg" />
            </header>
          )}

          <div
            className="flex-1 min-h-0 px-6 lg:px-10 xl:px-14 max-lg:pt-6 lg:pt-2 relative overflow-hidden flex flex-col"
            style={{ paddingTop: !activatedUser ? 'var(--app-safe-top)' : undefined }}
          >
            <AnimatePresence mode="wait">
              {sessionChecking ? (
                <motion.div
                  key="session-check"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="w-full h-full flex items-center justify-center text-white/50 text-sm"
                >
                  Verifying license...
                </motion.div>
              ) : !activatedUser ? (
                <motion.div
                  key="activation-screen"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                  className="w-full h-full min-h-0 flex flex-col justify-center lg:max-w-lg lg:mx-auto"
                >
                  <LoginScreen onActivate={handleActivate} />
                </motion.div>
              ) : (
                <React.Fragment>
                  {activeTab === 'home' && (
                    <motion.div
                      key="screen-1"
                      initial={{ opacity: 0, x: -15 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 15 }}
                      transition={{ duration: 0.35, ease: 'easeInOut' }}
                      className="w-full h-full min-h-0 flex flex-col"
                    >
                      <DashboardScreenOne />
                    </motion.div>
                  )}

                  {activeTab === 'signals' && (
                    <motion.div
                      key="screen-1.5"
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -15 }}
                      transition={{ duration: 0.35, ease: 'easeInOut' }}
                      className="w-full h-full min-h-0 flex flex-col"
                    >
                      <SignalsScreen />
                    </motion.div>
                  )}

                  {activeTab === 'stats' && (
                    <motion.div
                      key="screen-2"
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -15 }}
                      transition={{ duration: 0.35, ease: 'easeInOut' }}
                      className="w-full h-full min-h-0 flex flex-col"
                    >
                      <DashboardScreenTwo />
                    </motion.div>
                  )}

                  {activeTab === 'profile' && (
                    <motion.div
                      key="screen-3"
                      initial={{ opacity: 0, scale: 0.98, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98, y: -10 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                      className="w-full h-full min-h-0 flex flex-col"
                    >
                      <ProfileScreen
                        user={activatedUser}
                        onUserUpdate={(user) => {
                          saveNexusUser(user);
                          setActivatedUser(user);
                        }}
                      />
                    </motion.div>
                  )}
                </React.Fragment>
              )}
            </AnimatePresence>
          </div>

          {activatedUser && (
            <div className="lg:hidden">
              <BottomNavigation activeTab={activeTab} onChangeTab={setActiveTab} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
